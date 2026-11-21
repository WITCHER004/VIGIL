import { ApiError, handler, json, readJson, throttle, THROTTLE } from "@/lib/api";
import { db } from "@/lib/db";
import { getSimService, SIM_MODE_LABEL, SIM_SERVICES } from "@/lib/sim";
import { simulatorPatchSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

async function listServices() {
  const rows = await db.simService.findMany();
  const byId = new Map(rows.map((r) => [r.id, r]));
  const monitors = await db.monitor.findMany({
    where: { url: { in: SIM_SERVICES.map((s) => `/api/sim/${s.id}`) } },
    select: { id: true, name: true, url: true, status: true },
  });
  return SIM_SERVICES.map((s) => {
    const mode = byId.get(s.id)?.mode ?? s.defaultMode;
    return {
      id: s.id,
      label: s.label,
      path: `/api/sim/${s.id}`,
      mode,
      modeLabel: SIM_MODE_LABEL[mode],
      baseLatencyMs: s.baseLatencyMs,
      spikeLatencyMs: s.spikeLatencyMs,
      updatedAt: byId.get(s.id)?.updatedAt.toISOString() ?? null,
      monitors: monitors.filter((m) => m.url === `/api/sim/${s.id}`),
    };
  });
}

/** GET /api/simulator — mock services, their chaos modes and the monitors watching them. */
export const GET = handler(async () => json({ services: await listServices() }));

/** PATCH /api/simulator { service, mode } — flip a mock service between HEALTHY / LATENCY / OUTAGE. */
export const PATCH = handler(async (req: Request) => {
  await throttle(req, "simulator", THROTTLE.simulator);
  const { service, mode } = await readJson(req, simulatorPatchSchema);
  const svc = getSimService(service);
  if (!svc) throw new ApiError(404, "UNKNOWN_SERVICE", `No mock service "${service}".`);

  await db.simService.upsert({
    where: { id: svc.id },
    create: { id: svc.id, label: svc.label, mode },
    update: { mode },
  });
  return json({ services: await listServices() });
});
