"use client";

import { motion, useReducedMotion } from "framer-motion";
import { EASE_CLASSIC } from "@/lib/motion";
import { cn } from "@/lib/utils";

export type Tone = "ok" | "warn" | "crit" | "idle" | "copper";

export const TONE_RGB: Record<Tone, string> = {
    // CSS variable references so badges, dots and timelines follow the active theme.
  ok: "var(--c-ok)",
  warn: "var(--c-warn-text)",
  crit: "var(--c-crit)",
  idle: "var(--c-silver)",
  copper: "var(--c-brass)",
};

interface HeartbeatRippleProps {
  /** Increment to fire a ripple (e.g. each time a probe lands). 0 = no ripple yet. */
  beat: number;
  tone?: Tone;
  size?: number;
  className?: string;
  label?: string;
}

/**
 * Status dot with a single concentric ring that expands (scale 1 → 2.2) and
 * fades each time `beat` changes. Remounting via `key` restarts the animation
 * cleanly without a running loop.
 */
export function HeartbeatRipple({ beat, tone = "ok", size = 7, className, label }: HeartbeatRippleProps) {
  const reduce = useReducedMotion();
  const rgb = TONE_RGB[tone];
  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
      role={label ? "status" : undefined}
      aria-label={label}
    >
      {beat > 0 && !reduce && (
        <>
          <motion.span
            key={`ring-1-${beat}`}
            aria-hidden
            className="absolute inset-0 rounded-full"
            style={{ boxShadow: `0 0 0 1px rgb(${rgb} / 0.85)` }}
            initial={{ scale: 1, opacity: 0.8 }}
            animate={{ scale: 2.6, opacity: 0 }}
            transition={{ duration: 1.4, ease: EASE_CLASSIC }}
          />
          <motion.span
            key={`ring-2-${beat}`}
            aria-hidden
            className="absolute inset-0 rounded-full"
            style={{ boxShadow: `0 0 0 1px rgb(${rgb} / 0.5)` }}
            initial={{ scale: 1, opacity: 0.6 }}
            animate={{ scale: 1.8, opacity: 0 }}
            transition={{ duration: 1.1, delay: 0.15, ease: EASE_CLASSIC }}
          />
        </>
      )}
      <span
        aria-hidden
        className="relative h-full w-full rounded-full"
        style={{
          backgroundColor: `rgb(${rgb})`,
          boxShadow: `0 0 ${Math.max(6, size)}px rgb(${rgb} / 0.65)`,
        }}
      />
    </span>
  );
}

/** Map a monitor / system status to a ripple tone. */
export function toneForStatus(status: string | null | undefined): Tone {
  switch (status) {
    case "OPERATIONAL":
    case "RESOLVED":
    case "VALID":
      return "ok";
    case "DEGRADED":
    case "IDENTIFIED":
    case "MISSING":
      return "warn";
    case "DOWN":
    case "MAJOR_OUTAGE":
    case "PARTIAL_OUTAGE":
    case "INVESTIGATING":
    case "INVALID":
      return "crit";
    default:
      return "idle";
  }
}
