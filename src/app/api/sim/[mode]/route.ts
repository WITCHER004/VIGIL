import { json } from "@/lib/api";
import { db } from "@/lib/db";
import { getSimService, planSimResponse, SIM_SERVICES, type SimModeName } from "@/lib/sim";
import { sleep } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ mode: string }> };

/**
 * Built-in mock services: /api/sim/checkout-api, /api/sim/auth-gateway, /api/sim/ledger-sync
 *
 * Behaviour follows the service's chaos mode stored in Postgres:
 *   HEALTHY → 200 in ~base latency · LATENCY → 200 in ~680ms+ · OUTAGE → 503
 *
 * This route is read-only by design: chaos is toggled via /api/simulator, which is
 * deliberately *outside* /api/sim/* so the SSRF allowance for internal demo
 * targets can never be used (e.g. via a webhook replay) to flip modes.
 */
async function serve(req: Request, { params }: Ctx): Promise<Response> {
  const { mode: serviceId } = await params;

  // ─── Automated Recovery Runbook Endpoint (/api/sim/recover) ──────────────────
  if (serviceId === "recover") {
    let targetService: string | undefined;
    try {
      if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") {
        const body = await req.json().catch(() => ({}));
        if (body && typeof body === "object" && "serviceId" in body) {
          targetService = String((body as { serviceId?: unknown }).serviceId);
        }
      }
    } catch {
      // Body optional
    }

    if (!targetService) {
      const urlObj = new URL(req.url);
      targetService = urlObj.searchParams.get("serviceId") ?? undefined;
    }

    const servicesToRecover = targetService
      ? SIM_SERVICES.filter((s) => s.id === targetService)
      : SIM_SERVICES;

    for (const svc of servicesToRecover) {
      await db.simService.upsert({
        where: { id: svc.id },
        create: { id: svc.id, label: svc.label, mode: "HEALTHY" },
        update: { mode: "HEALTHY" },
      });
    }

    // Auto-probe matching monitors so state transitions to OPERATIONAL immediately
    const origin = new URL(req.url).origin;
    const { probeMonitor } = await import("@/lib/probe");
    const { addOperatorUpdate } = await import("@/lib/incidents");
    const monitors = await db.monitor.findMany({
      where: {
        url: { in: servicesToRecover.map((s) => `/api/sim/${s.id}`) },
      },
      include: {
        incidents: {
          where: { status: { not: "RESOLVED" } },
        },
      },
    });

    const probeResults = [];
    for (const m of monitors) {
      // Probe to record operational health
      const res = await probeMonitor(m, "manual", origin);
      probeResults.push({ monitorId: m.id, status: res.status });

      // If there was an open incident, resolve it with audited runbook note
      for (const inc of m.incidents) {
        try {
          await addOperatorUpdate(inc.id, {
            status: "RESOLVED",
            message: "Automated Recovery Runbook executed (/api/sim/recover). Target restored to HEALTHY; synthetic probe verified operational status.",
          });
        } catch {
          // Ignore if already transitioning
        }
      }
    }

    return json({
      ok: true,
      message: `Simulated service(s) recovered to HEALTHY.`,
      recovered: servicesToRecover.map((s) => s.id),
      probes: probeResults,
      timestamp: new Date().toISOString(),
    });
  }

  const svc = getSimService(serviceId);
  if (!svc) {
    return json(
      { error: { code: "UNKNOWN_SERVICE", message: `No mock service "${serviceId}".` }, services: SIM_SERVICES.map((s) => s.id) },
      { status: 404 },
    );
  }

  const row = await db.simService.findUnique({ where: { id: svc.id }, select: { mode: true } });
  const mode: SimModeName = row?.mode ?? svc.defaultMode;
  const plan = planSimResponse(svc, mode);
  await sleep(plan.delayMs);

  const headers = {
    "Cache-Control": "no-store",
    "X-Vigil-Sim-Service": svc.id,
    "X-Vigil-Sim-Mode": mode,
    ...(plan.status === 503 ? { "Retry-After": "30" } : {}),
  };
  if (req.method === "HEAD") return new Response(null, { status: plan.status, headers });
  return json({ ...plan.body, servedAt: new Date().toISOString(), simulatedLatencyMs: plan.delayMs }, { status: plan.status, headers });
}

export const GET = serve;
export const HEAD = serve;
export const POST = serve;
export const PUT = serve;
export const PATCH = serve;
export const DELETE = serve;
export const OPTIONS = serve;
