import type { SparkBar } from "@/lib/stats";
import { cn, formatMs, formatPercent } from "@/lib/utils";

const STATE_CLASS: Record<SparkBar["state"], string> = {
  ok: "bg-silver/45",
  degraded: "bg-warn",
  down: "bg-crit",
  empty: "bg-silver/10",
};

const fmtHour = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });

/**
 * 24-bar latency sparkline. Height encodes median latency relative to the
 * row's own peak; colour encodes health. Heights transition smoothly as
 * fresh probes land.
 */
export function Sparkline({ bars, className, height = 26 }: { bars: SparkBar[]; className?: string; height?: number }) {
  const peak = Math.max(1, ...bars.map((b) => b.latency ?? 0));
  return (
    <div className={cn("flex items-end gap-[2px]", className)} style={{ height }} role="img" aria-label="24 hour latency sparkline">
      {bars.map((b) => {
        const h = b.latency == null ? 3 : Math.max(3, Math.round(4 + (b.latency / peak) * (height - 4)));
        return (
          <span
            key={b.t}
            className={cn("w-[4px] shrink-0 rounded-[1px] transition-[height,background-color] duration-700 ease-classic", STATE_CLASS[b.state])}
            style={{ height: h }}
            suppressHydrationWarning
            title={`${fmtHour.format(b.t)} · p50 ${formatMs(b.latency)} · ${formatPercent(b.uptime, 2)} up`}
          />
        );
      })}
    </div>
  );
}
