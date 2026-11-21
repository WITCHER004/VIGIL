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
            animate={{ opacity: 1, y: 0, transition: transitionClassic(0.45) }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 12, transition: transitionClassic(0.3) }}
            className="panel reticle flex max-h-[min(78dvh,720px)] w-full flex-col rounded-md border border-hairline-strong bg-surface/95 backdrop-blur-xl shadow-[0_24px_64px_-16px_rgba(3,6,14,0.9)] sm:w-[400px]"
          >
            <header className="flex items-center justify-between border-b border-hairline px-5 py-4">
              <div>
                <p className="label">Live telemetry</p>
                <h2 className="text-[22px] leading-tight">Simulator</h2>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="grid h-8 w-8 place-items-center rounded-sm text-silver hover:bg-raised hover:text-ink" aria-label="Collapse simulator">
                <ChevronDown size={16} strokeWidth={1.5} />
              </button>
            </header>

            <div className="min-h-0 flex-1 divide-y divide-hairline overflow-y-auto">
              {/* Sweep */}
              <div className="px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[13px] font-medium text-ink">Run probe sweep</p>
                    <p className="text-[12px] text-silver">Probe every active monitor right now</p>
                  </div>
                  <button type="button" className="btn-primary h-8 shrink-0" onClick={doSweep} disabled={busy === "sweep" || sweeping}>
                    <Radar size={14} strokeWidth={1.5} />
                    {busy === "sweep" ? "Sweeping…" : "Sweep"}
                  </button>
                </div>
                <AnimatePresence initial={false}>
                  {sweep && (
                    <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} transition={transitionClassic(0.35)} className="mt-3 overflow-hidden">
                      {sweep.results.map((r) => (
                        <li key={r.monitorId} className="flex items-center justify-between gap-3 py-1 text-[12px]">
                          <span className="flex min-w-0 items-center gap-2">
                            <HeartbeatRipple beat={1} tone={toneForStatus(r.status)} size={6} />
                            <span className="truncate text-body">{r.name}</span>
                          </span>
                          <span className={cn("num", r.ok ? "text-ink" : "text-crit")}>{r.ok ? formatMs(r.latencyMs) : (r.statusCode ?? "ERR")}</span>
                        </li>
                      ))}
                    </motion.ul>
                  )}
                </AnimatePresence>
              </div>

              {/* Chaos */}
              <div className="px-5 py-4">
                <p className="text-[13px] font-medium text-ink">Toggle service chaos</p>
                <p className="text-[12px] text-silver">3 failed checks open an incident; 2 healthy checks resolve it</p>
                <div className="mt-3 flex flex-col gap-4">
                  {services.map((svc) => {
                    const monitorStatus = svc.monitors[0]?.status;
                    return (
                      <div key={svc.id}>
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                          <span className="num text-[12px] text-body">{svc.path}</span>
                          {monitorStatus && <StatusBadge status={monitorStatus} className="h-[19px]" />}
                        </div>
                        <div className="flex items-end gap-2">
                          <SegmentedTabs<SimMode>
                            ariaLabel={`${svc.label} chaos mode`}
                            size="sm"
                            className="flex-1"
                            value={svc.mode}
                            onChange={(m) => void setMode(svc, m)}
                            items={[
                              { value: "HEALTHY", label: <span>Healthy <span className="num text-silver/70">{svc.baseLatencyMs}ms</span></span> },
                              { value: "LATENCY", label: <span>Spike <span className="num text-silver/70">{svc.spikeLatencyMs}ms</span></span> },
                              { value: "OUTAGE", label: <span>Outage <span className="num text-silver/70">503</span></span> },
                            ]}
                          />
                          <button
                            type="button"
                            onClick={() => void burst(svc)}
                            disabled={busy === svc.id || svc.monitors.length === 0}
                            title="Probe three times — enough to open or resolve an incident"
                            className="btn-ghost h-8 shrink-0 !px-2 text-[12px]"
                          >
                            <Repeat size={13} strokeWidth={1.5} /> ×3
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Webhooks */}
              <div className="px-5 py-4">
                <p className="text-[13px] font-medium text-ink">Fire sample webhook</p>
                <p className="text-[12px] text-silver">Signed with the endpoint secret; goes through the real rate limiter</p>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {SAMPLE_PROVIDERS.map((p) => (
                    <button key={p} type="button" onClick={() => void fire(p)} disabled={busy === p} className="group flex min-w-0 flex-col items-start gap-1 border border-hairline px-2.5 py-2 text-left transition-colors hover:border-hairline-strong hover:bg-raised">
                      <span className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
                        <Send size={11} strokeWidth={1.5} className="text-silver transition-colors group-hover:text-ink" />
                        {PROVIDER_LABEL[p].name}
                      </span>
                      <span className="num block w-full truncate text-[12px] text-silver/80" title={PROVIDER_LABEL[p].event}>{PROVIDER_LABEL[p].event}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Log */}
              <div className="px-5 py-4">
                <p className="label mb-2">Dispatch log</p>
                {log.length === 0 ? (
                  <p className="text-[12px] text-silver/70">Actions appear here</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    <AnimatePresence initial={false}>
                      {log.map((e) => (
                        <motion.li key={e.id} layout initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0, transition: transitionClassic(0.3) }} className="flex items-start gap-2.5 text-[12px]">
                          <span className="num shrink-0 text-silver/60">{fmtClock.format(e.at)}</span>
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
          "flex h-10 items-center gap-2.5 rounded-full border px-4 text-[13px] font-medium backdrop-blur-md shadow-[0_8px_32px_-8px_rgba(3,6,14,0.8)] transition-all duration-200 active:scale-95",
          open
            ? "border-copper/70 bg-raised/95 text-ink shadow-[0_0_20px_rgba(232,116,59,0.25)]"
            : "border-hairline-strong bg-surface/85 text-body hover:border-hairline-strong hover:bg-raised/80 hover:text-ink",
        )}
      >
        <span className="relative flex h-3.5 w-3.5 items-center justify-center">
          <FlaskConical size={15} strokeWidth={1.5} className="text-copper" />
        </span>
        Simulator
      </button>
    </div>
  );
}
