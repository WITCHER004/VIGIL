"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, FlaskConical, Radar, Repeat, Send } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTelemetry } from "@/components/providers/TelemetryProvider";
import { HeartbeatRipple, toneForStatus } from "@/components/ui/HeartbeatRipple";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { apiFetch, errorMessage } from "@/lib/client/api";
import type { MonitorSummary, ProbeResult, SimMode, SimServiceDTO, SweepResponse } from "@/lib/client/types";
import { transitionClassic, useMotionPreset } from "@/lib/motion";
import { SAMPLE_PROVIDERS, type SampleProvider } from "@/lib/sample-payloads";
import { cn, formatMs } from "@/lib/utils";

const PROVIDER_LABEL: Record<SampleProvider, { name: string; event: string }> = {
  stripe: { name: "Stripe", event: "payment_intent.succeeded" },
  github: { name: "GitHub", event: "pull_request.opened" },
  razorpay: { name: "Razorpay", event: "order.paid" },
};

interface LogEntry {
  id: number;
  at: number;
  tone: "ok" | "warn" | "crit" | "idle" | "copper";
  text: string;
}

const fmtClock = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

/**
 * Collapsible "Live Telemetry Simulator" — lets a visitor exercise every
 * feature in seconds: sweep all monitors, flip a mock service between
 * HEALTHY / LATENCY / OUTAGE and watch the state machine react, and fire
 * signed provider webhooks straight into the capture bin.
 */
export function SimulatorDock() {
  const { runFullSweep, registerResults, bump, sweeping, version } = useTelemetry();
  const { reduce } = useMotionPreset();
  const [open, setOpen] = useState(false);
  const [services, setServices] = useState<SimServiceDTO[]>([]);
  const [sweep, setSweep] = useState<SweepResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);

  const push = useCallback((tone: LogEntry["tone"], text: string) => {
    setLog((l) => [{ id: Date.now() + Math.random(), at: Date.now(), tone, text }, ...l].slice(0, 8));
  }, []);

  const loadServices = useCallback(async () => {
    const res = await apiFetch<{ services: SimServiceDTO[] }>("/api/simulator");
    setServices(res.services);
  }, []);

  useEffect(() => {
    if (open) loadServices().catch(() => {});
  }, [open, version, loadServices]);

  const describe = (r: ProbeResult) =>
    r.incident.action === "open"
      ? `${r.name}: incident opened`
      : r.incident.action === "resolve"
        ? `${r.name}: incident auto-resolved`
        : `${r.name}: ${r.ok ? "OK" : (r.statusCode ?? "ERR")} in ${formatMs(r.latencyMs)}`;

  const toneOf = (r: ProbeResult): LogEntry["tone"] =>
    r.incident.action === "open" ? "crit" : r.incident.action === "resolve" ? "ok" : toneForStatus(r.status);

  const doSweep = async () => {
    setBusy("sweep");
    try {
      const res = await runFullSweep();
      setSweep(res);
      push("copper", `Sweep: ${res.probed} monitors in ${formatMs(res.durationMs)}`);
      for (const r of res.results) if (r.incident.action !== "none") push(toneOf(r), describe(r));
    } catch (err) {
      push("crit", errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const probeService = async (svc: SimServiceDTO, times = 1) => {
    for (let i = 0; i < times; i++) {
      for (const m of svc.monitors) {
        const res = await apiFetch<{ result: ProbeResult; monitor: MonitorSummary }>(`/api/monitors/${m.id}/probe`, { method: "POST" });
        registerResults([res.result]);
        push(toneOf(res.result), describe(res.result));
      }
    }
  };

  const setMode = async (svc: SimServiceDTO, mode: SimMode) => {
    if (svc.mode === mode) return;
    setBusy(svc.id);
    setServices((list) => list.map((s) => (s.id === svc.id ? { ...s, mode } : s)));
    try {
      const res = await apiFetch<{ services: SimServiceDTO[] }>("/api/simulator", { method: "PATCH", json: { service: svc.id, mode } });
      setServices(res.services);
      push(mode === "HEALTHY" ? "ok" : mode === "LATENCY" ? "warn" : "crit", `${svc.label} → ${mode === "LATENCY" ? "latency spike" : mode.toLowerCase()}`);
      await probeService(svc);
      bump();
    } catch (err) {
      push("crit", errorMessage(err));
      loadServices().catch(() => {});
    } finally {
      setBusy(null);
    }
  };

  const burst = async (svc: SimServiceDTO) => {
    setBusy(svc.id);
    try {
      await probeService(svc, 3);
      bump();
    } catch (err) {
      push("crit", errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const fire = async (provider: SampleProvider) => {
    setBusy(provider);
    try {
      const res = await apiFetch<{ event: { eventType: string | null; signatureStatus: string }; rateLimit: { remaining: number; limit: number } }>(
        "/api/simulator/webhook",
        { method: "POST", json: { provider } },
      );
      push(res.event.signatureStatus === "VALID" ? "copper" : "warn", `${PROVIDER_LABEL[provider].name} ${res.event.eventType} · ${res.event.signatureStatus.toLowerCase()} · ${res.rateLimit.remaining}/${res.rateLimit.limit} tokens`);
      bump();
    } catch (err) {
      push("crit", errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="no-print fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2 max-sm:left-4">
      <AnimatePresence>
        {open && (
          <motion.section
            key="dock"
            id="simulator-dock"
            aria-label="Live telemetry simulator"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0, transition: transitionClassic(0.4) }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 12, transition: transitionClassic(0.25) }}
            className="flex max-h-[min(80dvh,720px)] w-full flex-col rounded-[2px] border border-hairline-strong bg-surface shadow-placard sm:w-[420px]"
          >
            <header className="flex items-center justify-between border-b border-hairline bg-well/40 px-5 py-3.5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-6 w-6 items-center justify-center rounded-[2px] bg-vermilion/10 text-vermilion border border-vermilion/20">
                  <FlaskConical size={13} strokeWidth={1.8} />
                </div>
                <div>
                  <p className="font-sans text-[10px] font-semibold uppercase tracking-[0.16em] text-silver">Tactile Instrument</p>
                  <h2 className="font-display text-[19px] font-normal leading-tight text-ink">Simulator Dock</h2>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="btn-ghost !h-7 !w-7 !p-0"
                aria-label="Collapse simulator"
              >
                <ChevronDown size={14} strokeWidth={1.5} />
              </button>
            </header>

            <div className="min-h-0 flex-1 divide-y divide-hairline overflow-y-auto">
              {/* Sweep */}
              <div className="p-4 sm:p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[13px] font-medium text-ink">Probe sweep</p>
                    <p className="text-[12px] text-body">Simultaneous probe of all targets</p>
                  </div>
                  <button type="button" className="btn-primary !h-8 shrink-0" onClick={doSweep} disabled={busy === "sweep" || sweeping}>
                    <Radar size={13} strokeWidth={1.5} />
                    {busy === "sweep" ? "Sweeping…" : "Run sweep"}
                  </button>
                </div>
                <AnimatePresence initial={false}>
                  {sweep && (
                    <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} transition={transitionClassic(0.35)} className="mt-3 overflow-hidden rounded-[2px] border border-hairline bg-well/50 p-2.5">
                      {sweep.results.map((r) => (
                        <li key={r.monitorId} className="flex items-center justify-between gap-3 py-1 text-[12px]">
                          <span className="flex min-w-0 items-center gap-2">
                            <HeartbeatRipple beat={1} tone={toneForStatus(r.status)} size={6} />
                            <span className="truncate font-medium text-ink">{r.name}</span>
                          </span>
                          <span className={cn("num font-mono text-[11px]", r.ok ? "text-viridian" : "text-vermilion")}>
                            {r.ok ? formatMs(r.latencyMs) : (r.statusCode ?? "ERR")}
                          </span>
                        </li>
                      ))}
                    </motion.ul>
                  )}
                </AnimatePresence>
              </div>

              {/* Chaos */}
              <div className="p-4 sm:p-5">
                <div className="flex items-center justify-between">
                  <p className="text-[13px] font-medium text-ink">Chaos injection</p>
                  <span className="font-mono text-[10px] text-silver">3 FAIL = OPEN</span>
                </div>
                <p className="text-[12px] text-body">Flip targets to test state machine transitions</p>
                <div className="mt-3 flex flex-col gap-3">
                  {services.map((svc) => {
                    const monitorStatus = svc.monitors[0]?.status;
                    return (
                      <div key={svc.id} className="rounded-[2px] border border-hairline bg-well/30 p-2.5">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="font-mono text-[11px] font-medium text-ink">{svc.path}</span>
                          {monitorStatus && <StatusBadge status={monitorStatus} className="h-[18px]" />}
                        </div>
                        <div className="flex items-center gap-2">
                          <SegmentedTabs<SimMode>
                            ariaLabel={`${svc.label} chaos mode`}
                            size="sm"
                            className="flex-1"
                            value={svc.mode}
                            onChange={(m) => void setMode(svc, m)}
                            items={[
                              { value: "HEALTHY", label: <span>Healthy <span className="num text-silver">{svc.baseLatencyMs}ms</span></span> },
                              { value: "LATENCY", label: <span>Spike <span className="num text-silver">{svc.spikeLatencyMs}ms</span></span> },
                              { value: "OUTAGE", label: <span>Outage <span className="num text-vermilion">503</span></span> },
                            ]}
                          />
                          <button
                            type="button"
                            onClick={() => void burst(svc)}
                            disabled={busy === svc.id || svc.monitors.length === 0}
                            title="Probe three times — enough to open or resolve an incident"
                            className="btn-ghost !h-7 shrink-0 !px-2 text-[11px]"
                          >
                            <Repeat size={12} strokeWidth={1.5} /> ×3
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Webhooks */}
              <div className="p-4 sm:p-5">
                <p className="text-[13px] font-medium text-ink">Provider webhooks</p>
                <p className="text-[12px] text-body">Signed dispatch through HMAC validator</p>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {SAMPLE_PROVIDERS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => void fire(p)}
                      disabled={busy === p}
                      className="group flex min-w-0 flex-col items-start gap-1 rounded-[2px] border border-hairline bg-surface p-2 text-left transition-colors hover:border-hairline-strong hover:bg-well active:scale-[0.98]"
                    >
                      <span className="flex items-center gap-1.5 text-[12px] font-medium text-ink">
                        <Send size={11} strokeWidth={1.5} className="text-ultramarine" />
                        {PROVIDER_LABEL[p].name}
                      </span>
                      <span className="num block w-full truncate font-mono text-[10px] text-silver" title={PROVIDER_LABEL[p].event}>
                        {PROVIDER_LABEL[p].event}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Log */}
              <div className="p-4 sm:p-5">
                <p className="label mb-2">Telemetry Ledger</p>
                {log.length === 0 ? (
                  <p className="text-[12px] text-silver">Actions appear here</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    <AnimatePresence initial={false}>
                      {log.map((e) => (
                        <motion.li key={e.id} layout initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0, transition: transitionClassic(0.2) }} className="flex items-start gap-2 text-[12px]">
                          <span className="num shrink-0 font-mono text-[10px] text-silver">{fmtClock.format(e.at)}</span>
                          <HeartbeatRipple beat={0} tone={e.tone} size={5} className="mt-[5px]" />
                          <span className="min-w-0 text-body">{e.text}</span>
                        </motion.li>
                      ))}
                    </AnimatePresence>
                  </ul>
                )}
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="simulator-dock"
        className={cn(
          "flex h-9 items-center gap-2 rounded-[2px] border px-3.5 text-[12px] font-medium shadow-placard transition-all duration-150 active:scale-95",
          open
            ? "border-vermilion bg-surface text-ink font-semibold"
            : "border-hairline-strong bg-surface text-body hover:border-ink hover:text-ink",
        )}
      >
        <FlaskConical size={14} strokeWidth={1.8} className="text-vermilion" />
        <span>Simulator</span>
      </button>
    </div>
  );
}
