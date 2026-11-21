"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { transitionClassic, useMotionPreset } from "@/lib/motion";
import type { DailyUptime } from "@/lib/stats";
import { cn, formatDayKey } from "@/lib/utils";

function barColor(d: DailyUptime): string {
  if (d.uptime == null) return "bg-silver/12";
  if (d.uptime >= 99.95) return "bg-ok";
  if (d.uptime >= 99) return "bg-ok/60";
  if (d.uptime >= 95) return "bg-warn";
  return "bg-crit";
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
            animate={hover === i ? barLift : { y: 0, transition: transitionClassic(0.2) }}
            className={cn(
              "relative min-w-[3px] flex-1 rounded-[1.5px] transition-opacity duration-200 focus-visible:outline-offset-1",
              barColor(d),
              hover != null && hover !== i && "opacity-55",
            )}
            style={{ height }}
          >
            {d.incidents > 0 && <span className="absolute inset-x-0 top-0 h-[3px] rounded-t-[1.5px] bg-canvas/50" aria-hidden />}
          </motion.button>
        ))}

        <AnimatePresence>
          {active && hover != null && (
            <motion.div
              key="tip"
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.08 } }}
              transition={{ duration: 0.08 }}
              className="reticle pointer-events-none absolute bottom-full z-20 mb-3 w-[190px] -translate-x-1/2 rounded-sm border border-hairline-strong bg-raised/95 backdrop-blur-md px-3.5 py-2.5 shadow-[0_16px_36px_-8px_rgba(3,6,14,0.85)]"
              style={{ left: `${((hover + 0.5) / days.length) * 100}%` }}
            >
              <p className="text-[12px] font-medium text-ink">{formatDayKey(active.date)}</p>
              <div className="my-2 h-px bg-rule/80" />
              <dl className="num space-y-1 text-[12px]">
                <div className="flex justify-between">
                  <dt className="text-silver">Uptime</dt>
                  <dd className="text-ink">{active.uptime == null ? "No data" : `${active.uptime.toFixed(2)}%`}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-silver">Incidents</dt>
                  <dd className={active.incidents ? "text-warn" : "text-ink"}>{active.incidents}</dd>
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
