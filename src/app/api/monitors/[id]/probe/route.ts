import { handler, json, notFound, throttle, THROTTLE } from "@/lib/api";
import { db } from "@/lib/db";
import { getMonitorSummaries } from "@/lib/metrics";
import { probeMonitor } from "@/lib/probe";
import { getAppOrigin } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/monitors/:id/probe — run a manual probe now and return the result + refreshed summary. */
export const POST = handler(async (req: Request, { params }: Ctx) => {
  await throttle(req, "probe", THROTTLE.probe);
  const { id } = await params;
  const monitor = await db.monitor.findUnique({ where: { id } });
  if (!monitor) throw notFound("Monitor");

  const result = await probeMonitor(monitor, "manual", getAppOrigin(req.url));
  const [summary] = await getMonitorSummaries({ ids: [id] });
  return json({ result, monitor: summary });
});
