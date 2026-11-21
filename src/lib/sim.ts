/**
 * Built-in mock services served from /api/sim/[service].
 * Each service's mode is persisted in the `SimService` table so all
 * serverless instances agree; this file defines how each mode behaves.
 */

export type SimModeName = "HEALTHY" | "LATENCY" | "OUTAGE";

export interface SimServiceDef {
  id: string;
  label: string;
  /** Median latency in HEALTHY mode. */
  baseLatencyMs: number;
  /** Latency in LATENCY mode. */
  spikeLatencyMs: number;
  defaultMode: SimModeName;
}

export const SIM_SERVICES = [
  { id: "checkout-api", label: "Checkout API", baseLatencyMs: 45, spikeLatencyMs: 680, defaultMode: "HEALTHY" },
  { id: "auth-gateway", label: "Auth Gateway", baseLatencyMs: 62, spikeLatencyMs: 720, defaultMode: "HEALTHY" },
  { id: "ledger-sync", label: "Ledger Sync", baseLatencyMs: 140, spikeLatencyMs: 900, defaultMode: "OUTAGE" },
] as const satisfies readonly SimServiceDef[];

export type SimServiceId = (typeof SIM_SERVICES)[number]["id"];

export const SIM_MODES = ["HEALTHY", "LATENCY", "OUTAGE"] as const satisfies readonly SimModeName[];

export function getSimService(id: string): SimServiceDef | undefined {
  return SIM_SERVICES.find((s) => s.id === id);
}

/** Human labels used in the simulator dock. */
export const SIM_MODE_LABEL: Record<SimModeName, string> = {
  HEALTHY: "Healthy",
  LATENCY: "Latency spike",
  OUTAGE: "Outage (503)",
};

/**
 * Plan the response for a service in a given mode. Jitter keeps the latency
 * chart honest-looking (±18% around the target) instead of a flat line.
 */
export function planSimResponse(
  svc: SimServiceDef,
  mode: SimModeName,
  rng: () => number = Math.random,
): { delayMs: number; status: number; body: Record<string, unknown> } {
  const jitter = (base: number) => Math.max(1, Math.round(base * (0.82 + rng() * 0.36)));
  switch (mode) {
    case "HEALTHY":
      return {
        delayMs: jitter(svc.baseLatencyMs),
        status: 200,
        body: { status: "ok", service: svc.id, mode, region: "iad1" },
      };
    case "LATENCY":
      return {
        delayMs: jitter(svc.spikeLatencyMs),
        status: 200,
        body: { status: "ok", service: svc.id, mode, region: "iad1", note: "upstream saturation" },
      };
    case "OUTAGE":
      return {
        delayMs: jitter(Math.min(svc.baseLatencyMs, 80)),
        status: 503,
        body: { status: "unavailable", service: svc.id, mode, error: "upstream connect error or disconnect/reset" },
      };
  }
}
