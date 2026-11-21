"use client";

import { ArrowRight, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { LatencyChart } from "@/components/charts/LatencyChart";
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
  const { globalBeat, fleet } = useTelemetry();
  const { data } = useLiveResource<OverviewDTO>(`/api/overview?range=${range}`, [range], initial);
  const [drawer, setDrawer] = useState<{ open: boolean; monitor: MonitorSummary | null }>({ open: false, monitor: null });
  const [incidentId, setIncidentId] = useState<string | null>(null);

  const o = data ?? initial;
  const k = o.kpis;
  const headline = HEADLINE[o.systemStatus] ?? HEADLINE.OPERATIONAL!;
  const down = o.monitors.filter((m) => m.status === "DOWN");
  const degraded = o.monitors.filter((m) => m.status === "DEGRADED");

  return (
    <div className="mx-auto max-w-[1360px]">
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-2.5">
            <HeartbeatRipple beat={globalBeat} tone={toneForStatus(o.systemStatus)} size={6} />
            Live telemetry · {fleet.total || o.kpis.monitorsTotal} monitors
          </span>
        }
        title={headline}
        description={
          down.length > 0 ? (
            <>
              <span className="text-crit">{down.map((m) => m.name).join(", ")}</span> {down.length === 1 ? "is" : "are"} failing checks
              {degraded.length > 0 && (
                <>
                  , and <span className="text-warn">{degraded.length}</span> more {degraded.length === 1 ? "is" : "are"} degraded
                </>
              )}
              . Every probe is timed server-side and fed through the incident state machine in real time.
            </>
          ) : degraded.length > 0 ? (
            <>
              <span className="text-warn">{degraded.map((m) => m.name).join(", ")}</span> {degraded.length === 1 ? "is" : "are"} responding slowly or intermittently. No incident is open for them yet.
            </>
          ) : (
            "Every active endpoint answered its last probe within threshold. Vigil keeps probing while this page is open."
          )
        }
        actions={
          <>
            <Link href="/status/vigil" className="btn-ghost">
              Public status <ArrowRight size={14} strokeWidth={1.5} />
            </Link>
            <button type="button" className="btn-primary" onClick={() => setDrawer({ open: true, monitor: null })}>
              <Plus size={14} strokeWidth={1.5} /> New monitor
            </button>
          </>
        }
      />

      {/* KPIs */}
      <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Key metrics">
        <KpiCard
          label="Global uptime · 24h"
          value={<AnimatedMetric value={k.globalUptime} format={pct} minChars={7} />}
          footnote={`Weighted across ${k.monitorsActive} active monitors`}
        />
        <KpiCard label="Median p95 latency" value={<AnimatedMetric value={k.medianP95} format={formatMs} minChars={7} />} footnote="Median of each monitor’s 24h p95" />
        <KpiCard
          label="Active incidents"
          value={<AnimatedMetric value={k.activeIncidents} minChars={2} />}
          indicator={<span className={`dot ${k.activeIncidents > 0 ? "bg-crit" : "bg-ok"}`} aria-hidden />}
          footnote={
            <Link href="/incidents" className="transition-colors hover:text-ink">
              {k.activeIncidents > 0 ? "Open the incident log →" : "Nothing open · view history →"}
            </Link>
          }
        />
        <KpiCard
          label="Webhooks captured · 24h"
          value={<AnimatedMetric value={k.webhooks24h} minChars={3} />}
          footnote={
            k.webhooksPrev24h > 0
              ? `${k.webhooks24h >= k.webhooksPrev24h ? "+" : "−"}${Math.abs(Math.round(((k.webhooks24h - k.webhooksPrev24h) / k.webhooksPrev24h) * 100))}% vs previous day`
              : "No traffic the previous day"
          }
        />
      </section>

      {/* Chart + dispatches */}
      <section className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-8 xl:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)]">
        <div className="panel reticle registered p-5 sm:p-6">
          <SectionHeading
            title="Fleet latency"
            label={`p50, p95 and p99 across active monitors · ${RANGE_CONFIG[range].label.toLowerCase()}`}
            trailing={<SegmentedTabs ariaLabel="Time range" mono size="sm" items={TIME_RANGES.map((r) => ({ value: r, label: r }))} value={range} onChange={setRange} />}
          />
          <div className="mt-6">
            <LatencyChart series={o.series} range={range} height={300} />
          </div>
        </div>

        <aside className="panel reticle flex flex-col p-5 sm:p-6" aria-label="Recent incident dispatches">
          <SectionHeading title="Recent incidents" trailing={<Link href="/incidents" className="text-[13px] text-silver transition-colors hover:text-ink">View all</Link>} />
          <ul className="mt-4 flex-1 divide-y divide-hairline">
            {o.recentIncidents.length === 0 && <li className="py-10 text-center text-[13px] text-silver">No incidents recorded</li>}
            {o.recentIncidents.map((i) => (
              <li key={i.id}>
                <button type="button" onClick={() => setIncidentId(i.id)} className="group w-full py-3.5 px-2 -mx-2 rounded transition-colors hover:bg-raised/40 text-left">
                  <div className="flex items-center justify-between gap-3">
                    <StatusBadge status={i.status} />
                    <DowntimeCounter startedAt={i.startedAt} resolvedAt={i.resolvedAt} downtimeSec={i.downtimeSec} className="text-[12px] text-body" />
                  </div>
                  <p className="mt-2 line-clamp-2 text-[13px] leading-snug text-ink transition-colors group-hover:text-ink">{i.title}</p>
                  <p className="mt-1 text-[12px] text-silver">
                    {i.monitor.name} · <Time value={i.startedAt} />
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </aside>
      </section>

      {/* Registry */}
      <section className="mt-10">
        <SectionHeading
          title="Monitors"
          trailing={
            <Link href="/monitors" className="flex items-center gap-1.5 text-[13px] text-silver transition-colors hover:text-ink">
              Manage <ArrowRight size={14} strokeWidth={1.5} />
            </Link>
          }
        />
        <MonitorTable className="mt-4" monitors={o.monitors} onEdit={(m) => setDrawer({ open: true, monitor: m })} />
      </section>

      <MonitorDrawer open={drawer.open} monitor={drawer.monitor} onClose={() => setDrawer((d) => ({ ...d, open: false }))} />
      <IncidentTimelineDrawer incidentId={incidentId} onClose={() => setIncidentId(null)} />
    </div>
  );
}
