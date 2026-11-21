"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Pause, Pencil, Play as Resume } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useTelemetry } from "@/components/providers/TelemetryProvider";
import { AnimatedMetric } from "@/components/ui/AnimatedMetric";
import { HeartbeatRipple, toneForStatus } from "@/components/ui/HeartbeatRipple";
import { Sparkline } from "@/components/ui/Sparkline";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { apiFetch } from "@/lib/client/api";
import type { MonitorSummary } from "@/lib/client/types";
import { transitionClassic } from "@/lib/motion";
import { Time } from "@/components/ui/Time";
import { cn, formatMs as ms } from "@/lib/utils";
import { ProbeButton } from "./ProbeButton";

const pct = (v: number) => `${v.toFixed(2)}%`;

function uptimeTone(v: number | null) {
  if (v == null) return "text-silver";
  if (v >= 99.9) return "text-ink";
  if (v >= 99) return "text-body";
  if (v >= 95) return "text-warn";
  return "text-crit";
}

interface MonitorTableProps {
  monitors: MonitorSummary[];
  variant?: "compact" | "full";
  onEdit?: (m: MonitorSummary) => void;
  /** Called after an inline mutation (pause/resume, probe) so the parent can refresh. */
  onChanged?: () => void;
  emptyMessage?: string;
  className?: string;
}

/**
 * The Monitor Registry. Each row carries a live heartbeat ripple (fires as
 * probes land), status, 24-bar sparkline and rolling percentiles that morph
 * in place. `full` adds 7d/30d uptime, p50/p99, cadence and inline actions.
 */
export function MonitorTable({ monitors, variant = "compact", onEdit, onChanged, emptyMessage = "No monitors yet.", className }: MonitorTableProps) {
  const { pulses, bump } = useTelemetry();
  const [pending, setPending] = useState<string | null>(null);
  const full = variant === "full";

  const togglePause = async (m: MonitorSummary) => {
    setPending(m.id);
    try {
      await apiFetch(`/api/monitors/${m.id}`, { method: "PATCH", json: { isPaused: !m.isPaused } });
      bump();
      onChanged?.();
    } finally {
      setPending(null);
    }
  };

  return (
    <div className={cn("panel overflow-x-auto", className)}>
      <table className={cn("w-full text-left", full ? "min-w-[1080px]" : "min-w-[820px]")}>
        <thead>
          <tr className="label border-b border-hairline">
            <th className="py-3 pl-5 pr-3 font-medium">Monitor</th>
            <th className="px-3 py-3 font-medium">Status</th>
            <th className="px-3 py-3 font-medium">Last 24h</th>
            <th className="px-3 py-3 text-right font-medium">Uptime 24h</th>
            {full && <th className="px-3 py-3 text-right font-medium">7d</th>}
            {full && <th className="px-3 py-3 text-right font-medium">30d</th>}
            {full && <th className="px-3 py-3 text-right font-medium">p50</th>}
            <th className="px-3 py-3 text-right font-medium">p95</th>
            {full && <th className="px-3 py-3 text-right font-medium">p99</th>}
            <th className="px-3 py-3 text-right font-medium">Last check</th>
            <th className="py-3 pl-3 pr-5" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          <AnimatePresence initial={false}>
            {monitors.map((m) => (
              <motion.tr
                key={m.id}
                layout="position"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: transitionClassic(0.4) }}
                exit={{ opacity: 0, transition: transitionClassic(0.2) }}
                className={cn("group border-b border-hairline/70 transition-colors last:border-0 hover:bg-raised/30", m.isPaused && "opacity-60")}
              >
                <td className="max-w-[320px] py-3.5 pl-5 pr-3">
                  <div className="flex items-center gap-3.5">
                    <HeartbeatRipple beat={pulses[m.id] ?? 0} tone={toneForStatus(m.status)} label={`${m.name}: ${m.status.toLowerCase()}`} />
                    <div className="min-w-0">
                      <Link href={`/monitors/${m.id}`} className="block truncate text-[14px] text-ink transition-colors hover:text-ink">
                        {m.name}
                      </Link>
                      <p className="num truncate text-[12px] text-silver/80" title={m.url}>
                        <span className="text-silver/60">{m.method}</span> {m.url}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3.5">
                  <StatusBadge status={m.status} />
                </td>
                <td className="px-3 py-3.5">
                  <Sparkline bars={m.sparkline} />
                </td>
                <td className={cn("px-3 py-3.5 text-right text-[13px]", uptimeTone(m.uptime24h))}>
                  <AnimatedMetric value={m.uptime24h} format={pct} />
                </td>
                {full && <td className={cn("num px-3 py-3.5 text-right text-[13px]", uptimeTone(m.uptime7d))}>{m.uptime7d == null ? "—" : pct(m.uptime7d)}</td>}
                {full && <td className={cn("num px-3 py-3.5 text-right text-[13px]", uptimeTone(m.uptime30d))}>{m.uptime30d == null ? "—" : pct(m.uptime30d)}</td>}
                {full && (
                  <td className="px-3 py-3.5 text-right text-[13px] text-body">
                    <AnimatedMetric value={m.p50} format={ms} />
                  </td>
                )}
                <td className="px-3 py-3.5 text-right text-[13px] text-ink">
                  <AnimatedMetric value={m.p95} format={ms} />
                </td>
                {full && (
                  <td className="px-3 py-3.5 text-right text-[13px] text-body">
                    <AnimatedMetric value={m.p99} format={ms} />
                  </td>
                )}
                <td className="px-3 py-3.5 text-right">
                  <span className="block text-[13px] text-body">
                    <AnimatedMetric value={m.lastLatencyMs} format={ms} />
                  </span>
                  <span className="num block text-[12px] text-silver/70">
                    {m.lastCheckedAt ? <Time value={m.lastCheckedAt} /> : "never"}
                    {full && ` · ${m.intervalSec}s`}
                  </span>
                </td>
                <td className="py-3.5 pl-3 pr-5">
                  <div className="flex items-center justify-end gap-0.5">
                    <ProbeButton monitorId={m.id} size="sm" onResult={() => onChanged?.()} />
                    {full && (
                      <button
                        type="button"
                        onClick={() => void togglePause(m)}
                        disabled={pending === m.id}
                        className="grid h-7 w-7 place-items-center text-silver transition-colors hover:text-ink disabled:opacity-40"
                        aria-label={m.isPaused ? `Resume ${m.name}` : `Pause ${m.name}`}
                        title={m.isPaused ? "Resume" : "Pause"}
                      >
                        {m.isPaused ? <Resume size={13} strokeWidth={1.5} /> : <Pause size={13} strokeWidth={1.5} />}
                      </button>
                    )}
                    {onEdit && (
                      <button type="button" onClick={() => onEdit(m)} className="grid h-7 w-7 place-items-center text-silver transition-colors hover:text-ink" aria-label={`Edit ${m.name}`} title="Edit">
                        <Pencil size={13} strokeWidth={1.5} />
                      </button>
                    )}
                  </div>
                </td>
              </motion.tr>
            ))}
          </AnimatePresence>
          {monitors.length === 0 && (
            <tr>
              <td colSpan={full ? 11 : 7} className="px-5 py-14 text-center text-[13px] text-silver">
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
