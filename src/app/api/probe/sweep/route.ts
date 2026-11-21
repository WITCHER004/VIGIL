import { handler, json, readJson, throttle, THROTTLE } from "@/lib/api";
import { verifyOperatorAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { claimDueMonitors, runSweep } from "@/lib/probe";
import { getAppOrigin } from "@/lib/utils";
import { sweepSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/probe/sweep { scope: "due" | "all" }
 *
 * - "due": the dashboard's live polling engine calls this every few seconds while
 *   open. Only monitors whose interval has elapsed are leased and probed, so any
 *   number of open tabs collectively probe each monitor once per interval.
 * - "all": the simulator's "Run Probe Sweep" — probes every active monitor now.
 *
 * Operator authentication is enforced in production or whenever VIGIL_OPERATOR_SECRET is set.
 */
export const POST = handler(async (req: Request) => {
  await verifyOperatorAuth(req);
  await throttle(req, "sweep", THROTTLE.sweep);
  const { scope } = await readJson(req, sweepSchema);

  const monitors =
    scope === "all"
      ? await db.monitor.findMany({ where: { isPaused: false }, orderBy: { name: "asc" } })
      : await claimDueMonitors();

  const started = Date.now();
  const { results, errors } = await runSweep(monitors, scope === "all" ? "sweep" : "live", getAppOrigin(req.url));

  return json({
    scope,
    probed: results.length,
    durationMs: Date.now() - started,
    results,
    errors,
  });
});
