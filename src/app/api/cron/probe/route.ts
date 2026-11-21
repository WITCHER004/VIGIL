import { timingSafeEqual } from "node:crypto";
import { ApiError, handler, json } from "@/lib/api";
import { db } from "@/lib/db";
import { claimDueMonitors, runSweep } from "@/lib/probe";
import { refreshDailyStatPercentiles } from "@/lib/rollups";
import { getAppOrigin } from "@/lib/utils";
import { pruneAllWebhookEvents } from "@/lib/webhooks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production"; // zero-config local dev only
  const header = req.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * GET /api/cron/probe — invoked by Vercel Cron (see vercel.json) with
 * `Authorization: Bearer $CRON_SECRET`. Probes every monitor that is due,
 * in batches, until the function's time budget is nearly spent.
 */
export const GET = handler(async (req: Request) => {
  if (!authorized(req)) throw new ApiError(401, "UNAUTHORIZED", "Missing or invalid cron secret.");

  const origin = getAppOrigin(req.url);
  const deadline = Date.now() + 45_000;
  let probed = 0;
  const failures: { monitorId: string; error: string }[] = [];
  const incidents: { monitorId: string; action: string; incidentId: string | null }[] = [];

  while (Date.now() < deadline) {
    const batch = await claimDueMonitors(10);
    if (batch.length === 0) break;
    const { results, errors } = await runSweep(batch, "cron", origin);
    probed += results.length;
    failures.push(...errors);
    for (const r of results) {
      if (r.incident.action !== "none") {
        incidents.push({ monitorId: r.monitorId, action: r.incident.action, incidentId: r.incident.id });
      }
    }
  }

  // Retention pruning and metric rollups executed deterministically in background cron
  const prunedWebhookEvents = await pruneAllWebhookEvents(500).catch((err) => {
    console.error("[cron] webhook pruning error:", err);
    return 0;
  });

  const rolledToday = await refreshDailyStatPercentiles(db, new Date()).catch((err) => {
    console.error("[cron] daily rollup refresh error:", err);
    return 0;
  });

  return json({
    ok: true,
    probed,
    incidents,
    errors: failures,
    prunedWebhookEvents,
    rolledMonitors: rolledToday,
    at: new Date().toISOString(),
  });
});
