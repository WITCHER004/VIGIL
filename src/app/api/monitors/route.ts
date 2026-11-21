import { ApiError, handler, json, readJson, throttle, THROTTLE } from "@/lib/api";
import { db } from "@/lib/db";
import { getMonitorSummaries } from "@/lib/metrics";
import { probeMonitor } from "@/lib/probe";
import { resolveTarget } from "@/lib/ssrf";
import { getAppOrigin } from "@/lib/utils";
import { monitorCreateSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

const MAX_MONITORS = 50;

/** GET /api/monitors — registry with rolling uptime, percentiles and sparklines. */
export const GET = handler(async () => {
  const monitors = await getMonitorSummaries();
  return json({ monitors });
});

/** POST /api/monitors — create a monitor, validate its target, and run a first probe. */
export const POST = handler(async (req: Request) => {
  await throttle(req, "mutate", THROTTLE.mutate);
  const input = await readJson(req, monitorCreateSchema);
  const origin = getAppOrigin(req.url);

  // Reject private / metadata targets at save time (re-checked on every probe).
  await resolveTarget(input.url, origin);

  if ((await db.monitor.count()) >= MAX_MONITORS) {
    throw new ApiError(409, "LIMIT_REACHED", `This workspace is limited to ${MAX_MONITORS} monitors.`);
  }

  const statusPage = input.showOnStatusPage ? await db.statusPage.findFirst({ orderBy: { createdAt: "asc" } }) : null;
  const { showOnStatusPage: _omit, ...data } = input;

  const monitor = await db.monitor.create({
    data: {
      ...data,
      status: input.isPaused ? "PAUSED" : "PENDING",
      statusPageId: statusPage?.id ?? null,
    },
  });

  // Establish a baseline immediately so the registry row isn't empty.
  const firstProbe = monitor.isPaused ? null : await probeMonitor(monitor, "manual", origin).catch(() => null);
  const [summary] = await getMonitorSummaries({ ids: [monitor.id] });
  return json({ monitor: summary, firstProbe }, { status: 201 });
});
