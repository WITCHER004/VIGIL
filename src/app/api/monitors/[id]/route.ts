import { handler, json, notFound, readJson, readQuery, throttle, THROTTLE } from "@/lib/api";
import { db } from "@/lib/db";
import { getMonitorDetail, getMonitorSummaries } from "@/lib/metrics";
import { resolveTarget } from "@/lib/ssrf";
import { getAppOrigin } from "@/lib/utils";
import { monitorUpdateSchema, rangeQuerySchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/monitors/:id?range=24H — summary, range stats, latency series, status codes, incidents. */
export const GET = handler(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const { range } = readQuery(req, rangeQuerySchema);
  const detail = await getMonitorDetail(id, range);
  if (!detail) throw notFound("Monitor");
  return json(detail);
});

/** PATCH /api/monitors/:id — edit fields, pause / resume, toggle status-page visibility. */
export const PATCH = handler(async (req: Request, { params }: Ctx) => {
  await throttle(req, "mutate", THROTTLE.mutate);
  const { id } = await params;
  const input = await readJson(req, monitorUpdateSchema);
  const existing = await db.monitor.findUnique({ where: { id } });
  if (!existing) throw notFound("Monitor");

  if (input.url && input.url !== existing.url) await resolveTarget(input.url, getAppOrigin(req.url));

  const { showOnStatusPage, ...fields } = input;
  let statusPageId: string | null | undefined;
  if (showOnStatusPage === true && !existing.statusPageId) {
    statusPageId = (await db.statusPage.findFirst({ orderBy: { createdAt: "asc" } }))?.id ?? null;
  } else if (showOnStatusPage === false) {
    statusPageId = null;
  }

  // Pausing freezes the state machine; resuming starts a fresh streak.
  const pauseChange =
    fields.isPaused === true && !existing.isPaused
      ? { status: "PAUSED" as const }
      : fields.isPaused === false && existing.isPaused
        ? { status: "PENDING" as const, consecutiveFailures: 0, consecutiveSuccesses: 0, lastCheckedAt: null }
        : {};

  // Changing what is probed invalidates the current streak.
  const targetChanged = (["url", "method", "expectedStatus", "bodyContains"] as const).some(
    (k) => fields[k] !== undefined && fields[k] !== existing[k],
  );

  await db.monitor.update({
    where: { id },
    data: {
      ...fields,
      ...(statusPageId !== undefined ? { statusPageId } : {}),
      ...(targetChanged ? { consecutiveFailures: 0, consecutiveSuccesses: 0 } : {}),
      ...pauseChange,
    },
  });

  const [summary] = await getMonitorSummaries({ ids: [id] });
  return json({ monitor: summary });
});

/** DELETE /api/monitors/:id — removes the monitor with its checks and incidents. */
export const DELETE = handler(async (req: Request, { params }: Ctx) => {
  await throttle(req, "mutate", THROTTLE.mutate);
  const { id } = await params;
  await db.monitor.delete({ where: { id } });
  return json({ deleted: true, id });
});
