"use client";

import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { MonitorSummary } from "@/lib/client/types";
import { EASE_ATELIER, useMotionPreset } from "@/lib/motion";
import { cn, formatMs } from "@/lib/utils";
import { arcPath, dialSegments, polar } from "./dial-geometry";

const STATUS_STROKE: Record<MonitorSummary["status"], string> = {
  OPERATIONAL: "stroke-ok",
  DEGRADED: "stroke-warn",
  DOWN: "stroke-crit",
  PAUSED: "stroke-steel",
  PENDING: "stroke-steel",
};

const STATUS_TEXT: Record<MonitorSummary["status"], { label: string; cls: string }> = {
  OPERATIONAL: { label: "Operational", cls: "text-ok" },
  DEGRADED: { label: "Degraded", cls: "text-warn" },
  DOWN: { label: "Outage", cls: "text-crit" },
  PAUSED: { label: "Paused", cls: "text-silver" },
  PENDING: { label: "Pending", cls: "text-silver" },
};

const SIZE = 200;
const C = SIZE / 2;
const RING_R = 84;
const TICK_OUTER = 96;

interface SystemDialProps {
  monitors: Pick<MonitorSummary, "id" | "name" | "status" | "p95">[];
  /** Increments on every probe sweep; turns the brass hand one step. */
  beat: number;
  className?: string;
}

/**
 * Horological system dial: one arc per monitor, tinted by live status, inside a
 * 60-tick bezel. Hover or focus an arc to read it in the center; click or Enter opens it.
 */
export function SystemDial({ monitors, beat, className }: SystemDialProps) {
  const router = useRouter();
  const { reduce } = useMotionPreset();
  const [hoverId, setHoverId] = useState<string | null>(null);

  const segments = useMemo(() => dialSegments(monitors.length), [monitors.length]);
  const hovered = monitors.find((m) => m.id === hoverId) ?? null;
  const live = monitors.filter((m) => m.status !== "PAUSED");
  const up = live.filter((m) => m.status === "OPERATIONAL").length;
  const handDeg = (beat * 30) % 360;

  return (
    <div className={cn("relative mx-auto aspect-square w-full max-w-[210px]", className)}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-full w-full overflow-visible" role="group" aria-label={`System dial: ${up} of ${live.length} active monitors operational`}>
        {/* Bezel: 60 minute ticks, every fifth longer */}
        <g className="stroke-steel">
          {Array.from({ length: 60 }, (_, i) => {
            const major = i % 5 === 0;
            const [x1, y1] = polar(C, C, TICK_OUTER, i * 6);
            const [x2, y2] = polar(C, C, TICK_OUTER - (major ? 6 : 3), i * 6);
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={major ? 1.1 : 0.6} />;
          })}
        </g>
        <circle cx={C} cy={C} r={RING_R} fill="none" className="stroke-hairline" strokeWidth={1} />

        {/* Monitor arcs */}
        {segments.map((seg, i) => {
          const m = monitors[i]!;
          const active = hoverId === m.id;
          return (
            <path
              key={m.id}
              d={arcPath(C, C, RING_R, seg.start, seg.end)}
              fill="none"
              strokeLinecap="round"
              strokeWidth={active ? 7 : 5}
              className={cn(STATUS_STROKE[m.status], "cursor-pointer outline-none transition-[stroke-width,opacity] duration-200", hoverId && !active && "opacity-40")}
              tabIndex={0}
              role="link"
              aria-label={`${m.name}: ${STATUS_TEXT[m.status].label}, p95 ${formatMs(m.p95)}`}
              onMouseEnter={() => setHoverId(m.id)}
              onMouseLeave={() => setHoverId(null)}
              onFocus={() => setHoverId(m.id)}
              onBlur={() => setHoverId(null)}
              onClick={() => router.push(`/monitors/${m.id}`)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  router.push(`/monitors/${m.id}`);
                }
              }}
            />
          );
        })}

        {/* Brass hand */}
        <motion.g
          // Framer defaults SVG transforms to fill-box; pin the pivot to the dial centre in view-box units.
          style={{ transformBox: "view-box", originX: `${C}px`, originY: `${C}px` }}
          animate={{ rotate: handDeg }}
          transition={reduce ? { duration: 0 } : { duration: 1.2, ease: EASE_ATELIER }}
          aria-hidden
        >
          {/* Starts outside the centre readout so the hand never crosses the text */}
          <line x1={C} y1={C - 40} x2={C} y2={C - RING_R + 10} className="stroke-brass" strokeWidth={1.25} strokeLinecap="round" />
        </motion.g>
      </svg>

      {/* Center readout */}
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <div className="max-w-[58%] text-center" aria-live="polite">
          {hovered ? (
            <>
              <p className="truncate text-[12px] font-medium text-ink">{hovered.name}</p>
              <p className={cn("text-[11px]", STATUS_TEXT[hovered.status].cls)}>{STATUS_TEXT[hovered.status].label}</p>
              <p className="num mt-0.5 text-[11px] text-silver">p95 {formatMs(hovered.p95)}</p>
            </>
          ) : (
            <>
              <p className="num text-[22px] leading-none text-ink">
                {up}/{live.length}
              </p>
              <p className="mt-1 text-[11px] text-silver">operational</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
