"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { LatencyChart } from "@/components/charts/LatencyChart";
import { SystemDial } from "@/components/graphics/SystemDial";
import { DowntimeCounter, IncidentTimelineDrawer } from "@/components/incidents/IncidentTimelineDrawer";
import { MonitorDrawer } from "@/components/monitors/MonitorDrawer";
import { MonitorTable } from "@/components/monitors/MonitorTable";
import { useLiveResource, useTelemetry } from "@/components/providers/TelemetryProvider";
import { AnimatedMetric } from "@/components/ui/AnimatedMetric";
import { HeartbeatRipple, toneForStatus } from "@/components/ui/HeartbeatRipple";
import { KpiCard } from "@/components/ui/KpiCard";
import { PageHeader, SectionHeading } from "@/components/ui/PageHeader";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Time } from "@/components/ui/Time";
import type { MonitorSummary, OverviewDTO } from "@/lib/client/types";
import { RANGE_CONFIG, TIME_RANGES, type TimeRange } from "@/lib/stats";
import { formatMs } from "@/lib/utils";

const pct = (v: number) => `${v.toFixed(2)}%`;

const HEADLINE: Record<string, string> = {
  OPERATIONAL: "All systems operational",
  DEGRADED: "Degraded performance",
  MAJOR_OUTAGE: "Outage in progress",
};

export function OverviewView({ initial }: { initial: OverviewDTO }) {
  const [range, setRange] = useState<TimeRange>("24H");
  const { globalBeat } = useTelemetry();
  const { data } = useLiveResource<OverviewDTO>(`/api/overview?range=${range}`, [range], initial);
  const [drawer, setDrawer] = useState<{ open: boolean; monitor: MonitorSummary | null }>({ open: false, monitor: null });
  const [incidentId, setIncidentId] = useState<string | null>(null);

  const o = data ?? initial;
  const k = o.kpis;
  const down = o.monitors.filter((m) => m.status === "DOWN");
  const degraded = o.monitors.filter((m) => m.status === "DEGRADED");
  const webhookDelta =
    k.webhooksPrev24h > 0 ? Math.round(((k.webhooks24h - k.webhooksPrev24h) / k.webhooksPrev24h) * 100) : null;

  return (
    <div className="mx-auto max-w-[1320px] space-y-10">
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-2.5">
            <HeartbeatRipple beat={globalBeat} tone={toneForStatus(o.systemStatus)} size={6} />
            Live telemetry · {k.monitorsActive} active monitors
          </span>
        }
        title={HEADLINE[o.systemStatus] ?? HEADLINE.OPERATIONAL}
        description={
          down.length > 0 ? (
            <>
              <span className="font-medium text-crit">{down.map((m) => m.name).join(", ")}</span> {down.length === 1 ? "is" : "are"} failing checks
              {degraded.length > 0 && (
                <>
                  {" "}and <span className="font-medium text-warn">{degraded.length}</span> more {degraded.length === 1 ? "is" : "are"} degraded
                </>
              )}
              . Open a monitor to see what failed and how to fix it.
            </>
          ) : degraded.length > 0 ? (
            <>
              <span className="font-medium text-warn">{degraded.map((m) => m.name).join(", ")}</span> {degraded.length === 1 ? "is" : "are"} responding slowly.
            </>
          ) : (
            "Every active endpoint answered its last probe within threshold."
          )
        }
      />

      {/* Overview band: four numbers + the dial */}
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]" aria-label="Key metrics">
        <div className="grid gap-4 sm:grid-cols-2">
          <KpiCard index={1} label="Global uptime · 24h" value={<AnimatedMetric value={k.globalUptime} format={pct} minChars={7} />} footnote={`Weighted across ${k.monitorsActive} active monitors`} />
          <KpiCard index={2} label="Median p95 latency" value={<AnimatedMetric value={k.medianP95} format={formatMs} minChars={7} />} footnote="Median of each monitor’s 24h p95" />
          <KpiCard
            index={3}
            label="Active incidents"
            value={<AnimatedMetric value={k.activeIncidents} minChars={2} />}
            indicator={<span className={`dot ${k.activeIncidents > 0 ? "bg-crit" : "bg-ok"}`} aria-hidden />}
            footnote={
              <Link href="/incidents" className="font-medium text-ink underline-offset-4 hover:underline">
                {k.activeIncidents > 0 ? "Open the incident log" : "View incident history"}
              </Link>
            }
          />
          <KpiCard
            index={4}
            label="Webhooks captured · 24h"
            value={<AnimatedMetric value={k.webhooks24h} minChars={3} />}
            footnote={webhookDelta == null ? "No traffic the previous day" : `${webhookDelta >= 0 ? "+" : "−"}${Math.abs(webhookDelta)}% vs previous day`}
          />
        </div>
        <div className="panel flex flex-col items-center justify-center gap-3 p-5">
          <SystemDial monitors={o.monitors} beat={globalBeat} />
          <p className="text-center text-[12px] text-silver">One arc per monitor · hover to read, click to open</p>
        </div>
      </section>

      {/* Telemetry */}
      <section className="panel p-5 sm:p-6">
        <SectionHeading
          title="Latency & uptime"
          label={`p50, p95 and p99 across active monitors · ${RANGE_CONFIG[range].label.toLowerCase()}`}
          trailing={<SegmentedTabs ariaLabel="Time range" mono size="sm" items={TIME_RANGES.map((r) => ({ value: r, label: r }))} value={range} onChange={setRange} />}
        />
        <div className="mt-6">
          <LatencyChart series={o.series} range={range} height={300} />
        </div>
      </section>

      {/* Registry */}
      <section className="space-y-4">
        <SectionHeading
          title="Monitors"
          label="Live status, 24-hour sparkline and p95 for every endpoint"
          trailing={
            <Link href="/monitors" className="flex items-center gap-1 text-[13px] font-medium text-body transition-colors hover:text-ink">
              All monitors <ArrowRight size={14} strokeWidth={1.75} />
            </Link>
          }
        />
        <MonitorTable monitors={o.monitors} onEdit={(m) => setDrawer({ open: true, monitor: m })} />
      </section>

      {/* Recent incidents */}
      <section className="space-y-4" aria-label="Recent incidents">
        <SectionHeading
          title="Recent incidents"
          trailing={
            <Link href="/incidents" className="flex items-center gap-1 text-[13px] font-medium text-body transition-colors hover:text-ink">
              Incident log <ArrowRight size={14} strokeWidth={1.75} />
            </Link>
          }
        />
        {o.recentIncidents.length === 0 ? (
          <div className="panel px-6 py-10 text-center text-[13px] text-silver">No incidents recorded yet.</div>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {o.recentIncidents.map((i) => (
              <li key={i.id}>
                <button type="button" onClick={() => setIncidentId(i.id)} className="panel panel-interactive h-full w-full p-4 text-left">
                  <div className="flex items-center justify-between gap-3">
                    <StatusBadge status={i.status} />
                    <DowntimeCounter startedAt={i.startedAt} resolvedAt={i.resolvedAt} downtimeSec={i.downtimeSec} className="font-mono text-[12px] text-body" />
                  </div>
                  <p className="mt-2 line-clamp-2 text-[13px] font-medium text-ink">{i.title}</p>
                  <p className="mt-1 text-[12px] text-silver">
                    {i.monitor.name} · <Time value={i.startedAt} />
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <MonitorDrawer open={drawer.open} monitor={drawer.monitor} onClose={() => setDrawer((d) => ({ ...d, open: false }))} />
      <IncidentTimelineDrawer incidentId={incidentId} onClose={() => setIncidentId(null)} />
    </div>
  );
}
