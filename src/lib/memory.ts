import "server-only";
import { IncidentStatus } from "@prisma/client";
import { db } from "./db";
import { diagnoseIncident, type DiagnosticReport } from "./diagnostics";
import { formatDateTime, formatDuration } from "./utils";

export interface HistoricalPrecedent {
  incidentId: string;
  monitorName: string;
  title: string;
  resolutionNote: string;
  downtimeSec: number;
  timeToRecoverFormatted: string;
  resolvedAt: string;
  similarityReason: string;
}

/**
 * Searches operational memory for past resolved incidents that match the current monitor or failure pattern.
 */
export async function findHistoricalPrecedent(
  monitorId: string,
  statusCode?: number | null,
): Promise<HistoricalPrecedent | null> {
  // First priority: Past resolved incidents for this exact monitor
  const pastIncidentSameMonitor = await db.incident.findFirst({
    where: {
      monitorId,
      status: IncidentStatus.RESOLVED,
      downtimeSec: { not: null },
    },
    orderBy: { resolvedAt: "desc" },
    include: {
      monitor: { select: { name: true } },
      updates: {
        where: { status: IncidentStatus.RESOLVED },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  if (pastIncidentSameMonitor) {
    const resNote = pastIncidentSameMonitor.updates[0]?.message ?? "Incident resolved and verified by synthetic probes.";
    const sec = pastIncidentSameMonitor.downtimeSec ?? 0;
    return {
      incidentId: pastIncidentSameMonitor.id,
      monitorName: pastIncidentSameMonitor.monitor.name,
      title: pastIncidentSameMonitor.title,
      resolutionNote: resNote,
      downtimeSec: sec,
      timeToRecoverFormatted: formatDuration(sec),
      resolvedAt: pastIncidentSameMonitor.resolvedAt?.toISOString() ?? new Date().toISOString(),
      similarityReason: `Exact monitor match ("${pastIncidentSameMonitor.monitor.name}")`,
    };
  }

  // Second priority: If statusCode is provided (e.g. 503), find any past resolved incident mentioning that status code
  if (statusCode != null) {
    const pastIncidentCode = await db.incident.findFirst({
      where: {
        status: IncidentStatus.RESOLVED,
        title: { contains: String(statusCode) },
        downtimeSec: { not: null },
      },
      orderBy: { resolvedAt: "desc" },
      include: {
        monitor: { select: { name: true } },
        updates: {
          where: { status: IncidentStatus.RESOLVED },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (pastIncidentCode) {
      const resNote = pastIncidentCode.updates[0]?.message ?? "Error rate back to baseline. Post-incident review completed.";
      const sec = pastIncidentCode.downtimeSec ?? 0;
      return {
        incidentId: pastIncidentCode.id,
        monitorName: pastIncidentCode.monitor.name,
        title: pastIncidentCode.title,
        resolutionNote: resNote,
        downtimeSec: sec,
        timeToRecoverFormatted: formatDuration(sec),
        resolvedAt: pastIncidentCode.resolvedAt?.toISOString() ?? new Date().toISOString(),
        similarityReason: `Cross-service pattern match (HTTP ${statusCode})`,
      };
    }
  }

  return null;
}

/**
 * Compiles incident timeline, diagnostic evidence, executed remediation actions,
 * and duration into a clean, comprehensive Markdown Postmortem report.
 */
export async function generateIncidentPostmortem(
  incidentId: string,
  diagnosticReport?: DiagnosticReport,
): Promise<{ markdown: string; filename: string }> {
  const incident = await db.incident.findUnique({
    where: { id: incidentId },
    include: {
      monitor: true,
      updates: { orderBy: { createdAt: "asc" } },
      remediations: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!incident) throw new Error(`Incident ${incidentId} not found`);

  // If no diagnostic report was passed in, compute one from recent checks
  let report = diagnosticReport;
  if (!report) {
    const recentChecks = await db.checkRun.findMany({
      where: { monitorId: incident.monitorId },
      orderBy: { checkedAt: "desc" },
      take: 20,
    });
    report = diagnoseIncident({
      incident,
      monitor: incident.monitor,
      recentChecks,
    });
  }

  const durationStr = incident.downtimeSec ? formatDuration(incident.downtimeSec) : "Ongoing";
  const dateFormatted = formatDateTime(incident.startedAt);

  const timelineRows = incident.updates
    .map(
      (u) =>
        `| ${new Date(u.createdAt).toISOString().replace("T", " ").replace(/\..+/, " UTC")} | **${u.status}** | ${
          u.author === "SYSTEM" ? "Vigil Automatic" : "Operator"
        } | ${u.message} |`,
    )
    .join("\n");

  const evidenceRows = report.evidenceChain
    .map((e) => `- **${e.label}**: ${e.detail} *(Severity: ${e.severity.toUpperCase()})*`)
    .join("\n");

  const remediationsList =
    incident.remediations.length > 0
      ? incident.remediations
          .map(
            (r) =>
              `- [x] **${r.title}** (${r.actionType}) — Status: \`${r.status}\` by *${r.executedBy}* at ${new Date(
                r.createdAt,
              ).toLocaleTimeString()}\n  ${r.outputPreview ? `\`\`\`\n  ${r.outputPreview}\n  \`\`\`` : ""}`,
          )
          .join("\n\n")
      : "_No automated runbooks or remediations were recorded for this incident._";

  const markdown = `# Vigil Incident Postmortem & Root Cause Analysis
**Incident ID:** \`${incident.id}\`  
**Target Resource:** ${incident.monitor.name} (\`${incident.monitor.url}\`)  
**Severity:** \`${incident.severity}\` | **State:** \`${incident.status}\`  
**Detection Time:** ${dateFormatted}  
**Total Downtime:** ${durationStr}  

---

## 1. Executive Summary
On ${dateFormatted}, synthetic health probes for **${incident.monitor.name}** exceeded the failure threshold, initiating incident \`${incident.id}\`.
- **Root Cause Classification:** ${report.rootCauseTitle}
- **Diagnostic Confidence:** \`${report.confidence}\`
- **Assessment:** ${report.summary}

---

## 2. Technical Evidence Chain
The deterministic diagnostic engine observed the following telemetry indicators:
${evidenceRows}

---

## 3. Incident Timeline
| Timestamp (UTC) | State | Actor | Description |
| :--- | :--- | :--- | :--- |
${timelineRows}

---

## 4. Remediation & Executed Runbooks
The following actions were audited through the Vigil Instant Solutions Engine:
${remediationsList}

---

## 5. Preventative & Long-Term Corrective Actions
- [ ] Review upstream concurrency thresholds and circuit-breaker backoff policies.
- [ ] Verify database connection pool headroom under peak traffic.
- [ ] Ensure synthetic probe frequency aligns with downstream burst rate-limiting parameters.
- [ ] Archive postmortem to engineering runbook repository.

---
*Generated automatically by Vigil Autonomous Observability Engine at ${new Date().toISOString()}.*
`;

  const filename = `postmortem-${incident.monitor.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${incident.id.slice(-6)}.md`;
  return { markdown, filename };
}
