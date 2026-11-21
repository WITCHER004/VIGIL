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
