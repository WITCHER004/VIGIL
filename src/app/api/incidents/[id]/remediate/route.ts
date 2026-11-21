import { ApiError, handler, json, notFound, readJson } from "@/lib/api";
import { db } from "@/lib/db";
import { addOperatorUpdate } from "@/lib/incidents";
import { probeMonitor } from "@/lib/probe";
import { safeFetch } from "@/lib/ssrf";
import { getAppOrigin } from "@/lib/utils";
import { z } from "zod";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const remediateSchema = z.object({
  actionType: z.enum(["RUNBOOK_WEBHOOK", "ADAPTIVE_BACKOFF", "COPY_SNIPPET", "SMART_REPLAY"]),
  title: z.string().min(1),
  targetUrl: z.string().optional(),
  serviceId: z.string().optional(),
  suggestedIntervalSec: z.number().int().positive().optional(),
});

/**
 * POST /api/incidents/:id/remediate
 * Executes an approval-gated remediation runbook or adaptive policy adjustment.
 * Permanently audits to RemediationLog and creates an IncidentUpdate timeline note.
 */
export const POST = handler(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const input = await readJson(req, remediateSchema);

  const incident = await db.incident.findUnique({
    where: { id },
    include: { monitor: true },
  });

  if (!incident) throw notFound("Incident");

  const appOrigin = getAppOrigin(req.url);
  let status: "VERIFIED" | "EXECUTED" | "FAILED" = "EXECUTED";
  let responseCode: number | null = null;
  let outputPreview: string | null = null;

  if (input.actionType === "RUNBOOK_WEBHOOK") {
    const rawTarget = input.targetUrl || "/api/sim/recover";
    const isLocalSim = rawTarget.startsWith("/api/sim/") || rawTarget.includes("/api/sim/recover");

    if (isLocalSim) {
      // Local chaos recovery: restore SimService and probe monitor
      const simServiceId = input.serviceId || incident.monitor.url.match(/^\/api\/sim\/([a-z0-9-]+)/)?.[1];
      if (simServiceId) {
        await db.simService.upsert({
          where: { id: simServiceId },
          create: { id: simServiceId, label: simServiceId, mode: "HEALTHY" },
          update: { mode: "HEALTHY" },
        });
      } else {
        await db.simService.updateMany({ data: { mode: "HEALTHY" } });
      }

      // Immediately run probe to record recovery
      const probeRes = await probeMonitor(incident.monitor, "manual", appOrigin);
      responseCode = probeRes.statusCode ?? 200;
      status = probeRes.ok ? "VERIFIED" : "FAILED";
      outputPreview = `Target "${simServiceId || 'sim'}" restored to HEALTHY. Probe verification: ${probeRes.status} (${probeRes.latencyMs}ms).`;

      // Auto-resolve incident if probe succeeded
      if (probeRes.ok) {
        await addOperatorUpdate(incident.id, {
          status: "RESOLVED",
          message: `Runbook "${input.title}" executed. Chaos target restored to HEALTHY. Probe confirmed HTTP ${responseCode} in ${probeRes.latencyMs}ms.`,
        });
      } else {
        await addOperatorUpdate(incident.id, {
          message: `Runbook "${input.title}" executed. Downstream probe result: ${probeRes.status}.`,
        });
      }
    } else {
      // Outbound external recovery webhook protected by SSRF guard
      try {
        const { response } = await safeFetch(rawTarget, appOrigin, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-vigil-remediation": incident.id,
            "x-vigil-action": input.title,
          },
          body: JSON.stringify({
            incidentId: incident.id,
            monitorId: incident.monitor.id,
            monitorName: incident.monitor.name,
            timestamp: new Date().toISOString(),
          }),
          timeoutMs: 10_000,
        });

        responseCode = response.status;
        const text = await response.text();
        outputPreview = text.slice(0, 300);
        status = response.status >= 200 && response.status < 300 ? "VERIFIED" : "FAILED";

        await addOperatorUpdate(incident.id, {
          message: `Dispatched recovery webhook to ${rawTarget} (HTTP ${response.status}). Status: ${status}.`,
        });
      } catch (err: unknown) {
        status = "FAILED";
        outputPreview = err instanceof Error ? err.message : String(err);
        await addOperatorUpdate(incident.id, {
          message: `Recovery webhook to ${rawTarget} failed: ${outputPreview}`,
        });
      }
    }
  } else if (input.actionType === "ADAPTIVE_BACKOFF") {
    const newInterval = input.suggestedIntervalSec || Math.max(incident.monitor.intervalSec * 2, 180);
    await db.monitor.update({
      where: { id: incident.monitor.id },
      data: { intervalSec: newInterval },
    });

    status = "VERIFIED";
    responseCode = 200;
    outputPreview = `Probe frequency relaxed: ${incident.monitor.intervalSec}s -> ${newInterval}s.`;

    await addOperatorUpdate(incident.id, {
      message: `Adaptive backoff engaged. Monitor probe interval changed from ${incident.monitor.intervalSec}s to ${newInterval}s to relieve downstream load.`,
    });
  } else {
    status = "EXECUTED";
    outputPreview = "Snippet copied to clipboard by operator.";
  }

  // Record permanent audit entry
  const log = await db.remediationLog.create({
    data: {
      incidentId: incident.id,
      actionType: input.actionType,
      title: input.title,
      status,
      executedBy: "operator",
      responseCode,
      outputPreview,
      metadata: {
        targetUrl: input.targetUrl,
        serviceId: input.serviceId,
        suggestedIntervalSec: input.suggestedIntervalSec,
      },
    },
  });

  const updatedIncident = await db.incident.findUnique({
    where: { id: incident.id },
    include: {
      monitor: true,
      updates: { orderBy: { createdAt: "asc" } },
      remediations: { orderBy: { createdAt: "desc" } },
    },
  });

  return json({
    ok: true,
    remediation: log,
    incident: updatedIncident,
  });
});
