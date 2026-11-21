"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { transitionClassic, useMotionPreset } from "@/lib/motion";
import type { DailyUptime } from "@/lib/stats";
import { cn, formatDayKey } from "@/lib/utils";

function barColor(d: DailyUptime): string {
  if (d.uptime == null) return "bg-well border border-hairline/60";
  if (d.uptime >= 99.95) return "bg-viridian";
  if (d.uptime >= 99) return "bg-viridian/85";
  if (d.uptime >= 95) return "bg-ochre";
  return "bg-vermilion";
}

interface UptimeBarStripProps {
  days: DailyUptime[];
  height?: number;
  className?: string;
  /** Show the "30 days ago · today" scale beneath the bars. */
  showScale?: boolean;
}

/**
 * Segmented daily uptime strip (one bar per UTC day). Hovering or focusing a
 * bar lifts it 2px and shows an instant tabular tooltip with the exact date,
 * uptime % and incident count.
 */
export function UptimeBarStrip({ days, height = 34, className, showScale = true }: UptimeBarStripProps) {
  const { barLift, reduce } = useMotionPreset();
  const [hover, setHover] = useState<number | null>(null);
  const active = hover != null ? days[hover] : null;
  const withData = days.filter((d) => d.uptime != null);
  const avg = withData.length ? withData.reduce((a, d) => a + (d.uptime ?? 0), 0) / withData.length : null;

  return (
    <div className={cn("relative", className)}>
      <div
        className="relative flex items-end gap-[3px]"
        style={{ height: height + 4 }}
        role="list"
        aria-label={`Daily uptime, last ${days.length} days${avg != null ? `, average ${avg.toFixed(2)}%` : ""}`}
        onMouseLeave={() => setHover(null)}
      >
        {days.map((d, i) => (
          <motion.button
            key={d.date}
            type="button"
            role="listitem"
            aria-label={`${formatDayKey(d.date)}: ${d.uptime == null ? "no data" : `${d.uptime.toFixed(2)}% uptime`}, ${d.incidents} incident${d.incidents === 1 ? "" : "s"}`}
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
            animate={hover === i ? { y: -3, scaleY: 1.05 } : { y: 0, scaleY: 1, transition: transitionClassic(0.2) }}
            className={cn(
              "relative min-w-[3px] flex-1 rounded-[1.5px] transition-opacity duration-150 focus-visible:outline-offset-1",
              barColor(d),
              hover != null && hover !== i && "opacity-40",
            )}
            style={{ height }}
          >
            {d.incidents > 0 && <span className="absolute inset-x-0 top-0 h-[3px] rounded-t-[1.5px] bg-ink/70" aria-hidden />}
          </motion.button>
        ))}

        <AnimatePresence>
          {active && hover != null && (
            <motion.div
              key="tip"
              initial={reduce ? false : { opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 2, transition: { duration: 0.08 } }}
              transition={{ duration: 0.12 }}
              className="pointer-events-none absolute bottom-full z-20 mb-3 w-[204px] -translate-x-1/2 rounded-[2px] border border-hairline-strong bg-surface p-3 shadow-placard"
              style={{ left: `${((hover + 0.5) / days.length) * 100}%` }}
            >
              <div className="flex items-center justify-between">
                <p className="font-sans text-[11px] font-semibold uppercase tracking-wider text-silver">
                  Placard · {formatDayKey(active.date)}
                </p>
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    active.uptime == null
                      ? "bg-silver/40"
                      : active.uptime >= 99
                        ? "bg-viridian"
                        : active.uptime >= 95
                          ? "bg-ochre"
                          : "bg-vermilion",
                  )}
                />
              </div>
              <div className="my-2 h-px bg-rule" />
              <dl className="num space-y-1 text-[12px]">
                <div className="flex justify-between">
                  <dt className="text-silver">Uptime</dt>
                  <dd className="font-medium text-ink">{active.uptime == null ? "No records" : `${active.uptime.toFixed(2)}%`}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-silver">Incidents</dt>
                  <dd className={active.incidents ? "font-medium text-vermilion" : "text-ink"}>{active.incidents}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-silver">Checks</dt>
                  <dd className="text-ink">{active.checks.toLocaleString()}</dd>
                </div>
              </dl>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {showScale && (
        <div className="label mt-2 flex justify-between text-silver/70">
          <span>{days.length} days ago</span>
          {avg != null && <span className="num normal-case tracking-normal">{avg.toFixed(2)}% average</span>}
          <span>Today</span>
        </div>
      )}
    </div>
  );
}
