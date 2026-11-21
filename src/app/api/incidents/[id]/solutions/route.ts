import { handler, json, notFound } from "@/lib/api";
import { db } from "@/lib/db";
import { diagnoseIncident } from "@/lib/diagnostics";
import { findHistoricalPrecedent } from "@/lib/memory";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/incidents/:id/solutions
 * Computes deterministic DiagnosticReport, matches operational memory for historical precedents,
 * and fetches previous audited remediation logs.
 */
export const GET = handler(async (req: Request, { params }: Ctx) => {
  const { id } = await params;

  const incident = await db.incident.findUnique({
    where: { id },
    include: {
      monitor: true,
      updates: { orderBy: { createdAt: "asc" } },
      remediations: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!incident) throw notFound("Incident");

  // Fetch recent check telemetry
  const recentChecks = await db.checkRun.findMany({
    where: { monitorId: incident.monitorId },
    orderBy: { checkedAt: "desc" },
    take: 30,
  });

  // Fetch baseline checks (older checks before incident started)
  const baselineChecks = await db.checkRun.findMany({
    where: {
      monitorId: incident.monitorId,
      checkedAt: { lt: incident.startedAt },
    },
    orderBy: { checkedAt: "desc" },
    take: 50,
  });

  const report = diagnoseIncident({
    incident,
    monitor: incident.monitor,
    recentChecks,
    baselineChecks,
  });

  const lastStatusCode = incident.monitor.lastStatusCode ?? recentChecks.find((c) => c.statusCode != null)?.statusCode ?? null;
  const precedent = await findHistoricalPrecedent(incident.monitorId, lastStatusCode);

  return json({
    report,
    precedent,
    remediations: incident.remediations,
  });
});
