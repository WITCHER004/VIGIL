"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTelemetry } from "@/components/providers/TelemetryProvider";
import { apiFetch, errorMessage } from "@/lib/client/api";
import type { MonitorSummary, ProbeResult } from "@/lib/client/types";
import { EASE_CLASSIC, transitionClassic } from "@/lib/motion";
import { cn, formatMs } from "@/lib/utils";

type Phase = "idle" | "probing" | "ok" | "fail";

interface ProbeButtonProps {
  monitorId: string;
  onResult?: (result: ProbeResult, monitor: MonitorSummary) => void;
  size?: "sm" | "md";
  className?: string;
}

/**
 * Manual probe trigger. Idle play glyph → rotating copper arc while the probe
 * is in flight → a check (or cross) that draws itself via pathLength, with the
 * measured latency, before settling back to idle.
 */
export function ProbeButton({ monitorId, onResult, size = "md", className }: ProbeButtonProps) {
  const { registerResults } = useTelemetry();
  const [phase, setPhase] = useState<Phase>("idle");
  const [latency, setLatency] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  const run = async () => {
    if (phase === "probing") return;
    setPhase("probing");
    setError(null);
    try {
      const res = await apiFetch<{ result: ProbeResult; monitor: MonitorSummary }>(`/api/monitors/${monitorId}/probe`, { method: "POST" });
      setLatency(res.result.latencyMs);
      setPhase(res.result.ok ? "ok" : "fail");
      if (!res.result.ok) setError(res.result.error);
      registerResults([res.result]);
      onResult?.(res.result, res.monitor);
    } catch (err) {
      setPhase("fail");
      setError(errorMessage(err));
    }
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPhase("idle"), 2200);
  };

  const dim = size === "sm" ? 14 : 16;

  return (
    <button
      type="button"
      onClick={run}
      disabled={phase === "probing"}
      title={error ?? "Probe now"}
      aria-label={phase === "probing" ? "Probing…" : "Probe now"}
      className={cn(
        size === "sm" ? "h-7 min-w-[28px] px-1.5" : "btn-ghost min-w-[118px]",
        "inline-flex items-center justify-center gap-2 rounded-sm text-silver transition-colors hover:text-ink",
        phase === "ok" && "text-ok hover:text-ok",
        phase === "fail" && "text-crit hover:text-crit",
        className,
      )}
    >
      <span className="relative grid place-items-center" style={{ width: dim, height: dim }}>
        <AnimatePresence mode="wait" initial={false}>
          {phase === "idle" && (
            <motion.span key="idle" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={transitionClassic(0.2)}>
              <Play size={dim - 2} strokeWidth={1.5} />
            </motion.span>
          )}
          {phase === "probing" && (
            <motion.svg
              key="spin"
              width={dim}
              height={dim}
              viewBox="0 0 16 16"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, rotate: 360 }}
              exit={{ opacity: 0 }}
              transition={{ rotate: { repeat: Infinity, duration: 0.9, ease: "linear" }, opacity: { duration: 0.15 } }}
            >
              <circle cx="8" cy="8" r="6.25" fill="none" stroke="rgb(143 163 199 / 0.25)" strokeWidth="1.5" />
              <path d="M8 1.75a6.25 6.25 0 0 1 6.25 6.25" fill="none" stroke="#E8743B" strokeWidth="1.5" strokeLinecap="round" />
            </motion.svg>
          )}
          {(phase === "ok" || phase === "fail") && (
            <motion.svg key={phase} width={dim} height={dim} viewBox="0 0 16 16" initial={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
              <motion.circle
                cx="8"
                cy="8"
                r="6.25"
                fill="none"
                stroke="currentColor"
                strokeOpacity={0.35}
                strokeWidth="1.5"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.35, ease: EASE_CLASSIC }}
              />
              <motion.path
                d={phase === "ok" ? "M5 8.2l2 2L11 6" : "M5.75 5.75l4.5 4.5M10.25 5.75l-4.5 4.5"}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.38, delay: 0.18, ease: EASE_CLASSIC }}
              />
            </motion.svg>
          )}
        </AnimatePresence>
      </span>
      {size === "md" && (
        <span className="num text-[13px]">
          {phase === "probing" ? "Probing…" : phase === "idle" ? "Probe now" : formatMs(latency)}
        </span>
      )}
    </button>
  );
}
