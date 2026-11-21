"use client";

import { motion, useReducedMotion } from "framer-motion";
import { EASE_CLASSIC } from "@/lib/motion";
import { cn } from "@/lib/utils";

export type Tone = "ok" | "warn" | "crit" | "idle" | "copper";

export const TONE_RGB: Record<Tone, string> = {
  ok: "79 168 139",
  warn: "212 162 76",
  crit: "214 82 70",
  idle: "143 163 199",
  copper: "232 116 59",
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
      className={cn("relative inline-flex shrink-0", className)}
      style={{ width: size, height: size }}
      role={label ? "status" : undefined}
      aria-label={label}
    >
      {beat > 0 && !reduce && (
        <motion.span
          key={beat}
          aria-hidden
          className="absolute inset-0 rounded-full"
          style={{ boxShadow: `0 0 0 1px rgb(${rgb} / 0.9)` }}
          initial={{ scale: 1, opacity: 0.7 }}
          animate={{ scale: 2.2, opacity: 0 }}
          transition={{ duration: 1.4, ease: EASE_CLASSIC }}
        />
      )}
      <span aria-hidden className="relative h-full w-full rounded-full" style={{ backgroundColor: `rgb(${rgb})` }} />
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
