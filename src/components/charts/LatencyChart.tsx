"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTheme } from "@/components/providers/ThemeProvider";
import { useMotionPreset } from "@/lib/motion";
import type { SeriesPoint, TimeRange } from "@/lib/stats";
import { cn, formatAxisTime, formatDateTime, formatMs, formatPercent } from "@/lib/utils";

// SVG presentation attributes can't resolve CSS variables, so the chart takes
// literal hex per theme (mirrors the tokens in globals.css).
const PALETTE = {
  light: { p50: "#625E56", p95: "#9E7B43", p99: "#9E2A2B", grid: "#DDD8CD", axis: "#C7C0B2", surface: "#FDFCF9" },
  dark: { p50: "#9E998E", p95: "#CFA866", p99: "#D64C4D", grid: "#2B2926", axis: "#45423D", surface: "#191816" },
} as const;

const SERIES = [
  { key: "p99", label: "p99", width: 1.6 },
  { key: "p95", label: "p95", width: 1.6 },
  { key: "p50", label: "p50", width: 1.6 },
] as const;

type SeriesKey = (typeof SERIES)[number]["key"];
type Palette = (typeof PALETTE)[keyof typeof PALETTE];

interface CrosshairProps {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: unknown }>;
}

/** Sharp floating readout: exact timestamp + percentile values for the hovered bucket. */
function CrosshairCard({ active, payload, colors }: CrosshairProps & { colors: Palette }) {
  const point = payload?.[0]?.payload as SeriesPoint | undefined;
  if (!active || !point) return null;
  return (
    <div className="min-w-[204px] rounded-md border border-hairline-strong bg-surface p-3.5 shadow-placard">
      <div className="flex items-center justify-between">
        <span className="label">Latency</span>
        <span className="num text-[11px] text-body">{formatDateTime(point.t)}</span>
      </div>
      <div className="my-2 h-px bg-rule" />
      <dl className="space-y-1.5">
        {SERIES.map((s) => (
          <div key={s.key} className="flex items-center justify-between gap-6">
            <dt className="flex items-center gap-2 text-[12px] text-body">
              <span className="h-[2px] w-3 rounded-full" style={{ backgroundColor: colors[s.key] }} />
              <span className="font-medium text-ink">{s.label}</span>
            </dt>
            <dd className="num text-[13px] font-semibold text-ink">{formatMs(point[s.key])}</dd>
          </div>
        ))}
      </dl>
      <div className="my-2 h-px bg-rule" />
      <div className="num flex justify-between text-[12px] text-silver">
        <span>
          {point.checks} checks{point.failures > 0 && <span className="font-medium text-crit"> · {point.failures} failed</span>}
        </span>
        <span className="font-medium text-ink">{formatPercent(point.uptime, 1)}</span>
      </div>
    </div>
  );
}

interface LatencyChartProps {
  series: SeriesPoint[];
  range: TimeRange;
  height?: number;
  className?: string;
  /** Hide the inline legend (when the parent renders its own). */
  hideLegend?: boolean;
}

/** Multi-percentile latency chart (p50 / p95 / p99) in the Vigil drafting style. */
export function LatencyChart({ series, range, height = 280, className, hideLegend }: LatencyChartProps) {
  const { reduce } = useMotionPreset();
  const { theme } = useTheme();
  const colors = PALETTE[theme];
  // Draw the paths on mount and when the range changes — not on every live refresh,
  // which would re-sweep the lines every few seconds.
  const [animateKey, setAnimateKey] = useState(range);
  const [drawing, setDrawing] = useState(true);
  useEffect(() => {
    if (range !== animateKey) {
      setAnimateKey(range);
      setDrawing(true);
    }
  }, [range, animateKey]);
  useEffect(() => {
    if (!drawing) return;
    const t = window.setTimeout(() => setDrawing(false), 1000);
    return () => window.clearTimeout(t);
  }, [drawing, animateKey]);
  const animate = drawing && !reduce;
  const hasData = series.some((p) => p.p50 != null);

  const latest = useMemo(() => {
    for (let i = series.length - 1; i >= 0; i--) if (series[i]!.p50 != null) return series[i]!;
    return null;
  }, [series]);

  const yMax = useMemo(() => {
    const peak = Math.max(0, ...series.map((p) => p.p99 ?? 0));
    if (peak === 0) return 100;
    const step = peak > 2000 ? 1000 : peak > 500 ? 250 : peak > 100 ? 50 : 10;
    return Math.ceil((peak * 1.08) / step) * step;
  }, [series]);

  return (
    <div className={cn("relative", className)}>
      {!hideLegend && (
        <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2">
          {SERIES.map((s) => (
            <div key={s.key} className="flex items-center gap-2">
              <span className="h-[2px] w-4 rounded-full" style={{ backgroundColor: colors[s.key] }} />
              <span className="label">{s.label}</span>
              <span className="num text-[13px] text-ink">{formatMs(latest?.[s.key as SeriesKey])}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ height }} className="relative">
        {!hasData && (
          <div className="absolute inset-0 z-10 grid place-items-center">
            <p className="label">No checks in this range</p>
          </div>
        )}
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart key={animateKey} data={series} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={colors.grid} strokeDasharray="3 4" />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(t: number) => formatAxisTime(t, range)}
              tickLine={false}
              axisLine={{ stroke: colors.axis }}
              tickMargin={10}
              minTickGap={48}
            />
            <YAxis
              domain={[0, yMax]}
              tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}ms`)}
              tickLine={false}
              axisLine={false}
              width={52}
              tickCount={5}
            />
            <Tooltip
              content={(props) => <CrosshairCard active={props.active} payload={props.payload} colors={colors} />}
              cursor={{ stroke: colors.axis, strokeWidth: 1, strokeDasharray: "2 2" }}
              isAnimationActive={false}
              offset={18}
            />
            {[...SERIES].reverse().map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stroke={colors[s.key]}
                strokeWidth={s.width}
                strokeDasharray={s.key === "p95" ? "4 3" : undefined}
                dot={(props: { index?: number; cx?: number; cy?: number; key?: React.Key | null }) => {
                  // A bucket with no neighbours forms a one-point segment, which a line can't draw —
                  // render it as a dot so isolated readings (e.g. after a gap) stay visible.
                  const i = props.index ?? -1;
                  const isolated = series[i]?.[s.key] != null && series[i - 1]?.[s.key] == null && series[i + 1]?.[s.key] == null;
                  return isolated && props.cx != null && props.cy != null ? (
                    <circle key={props.key ?? undefined} cx={props.cx} cy={props.cy} r={2.25} fill={colors[s.key]} />
                  ) : (
                    <g key={props.key ?? undefined} />
                  );
                }}
                connectNulls={false}
                isAnimationActive={animate}
                animationDuration={900}
                animationEasing="ease-out"
                activeDot={{ r: 3, fill: colors[s.key], stroke: colors.surface, strokeWidth: 2 }}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
