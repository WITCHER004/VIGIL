"use client";

import { ArrowRight, Info, Plus, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { KineticStatusTotem } from "@/components/art/KineticStatusTotem";
import { LatencyChart } from "@/components/charts/LatencyChart";
import { DowntimeCounter, IncidentTimelineDrawer } from "@/components/incidents/IncidentTimelineDrawer";
import { MonitorDrawer } from "@/components/monitors/MonitorDrawer";
import { MonitorTable } from "@/components/monitors/MonitorTable";
import { useLiveResource, useTelemetry } from "@/components/providers/TelemetryProvider";
import { HeartbeatRipple, toneForStatus } from "@/components/ui/HeartbeatRipple";
import { KpiCard } from "@/components/ui/KpiCard";
import { PageHeader, SectionHeading } from "@/components/ui/PageHeader";
import { RollingNumber } from "@/components/ui/RollingNumber";
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
  const [showHint, setShowHint] = useState(true);

  const o = data ?? initial;
  const k = o.kpis;
  const headline = HEADLINE[o.systemStatus] ?? HEADLINE.OPERATIONAL!;
  const down = o.monitors.filter((m) => m.status === "DOWN");
  const degraded = o.monitors.filter((m) => m.status === "DEGRADED");

  return (
    <div className="mx-auto max-w-[1380px] space-y-8">
      {/* Onboarding / Exhibition Room Hint */}
      {showHint && (
        <div className="flex items-center justify-between rounded-[2px] border border-hairline bg-surface px-4 py-2.5 text-[12px] text-body shadow-sm">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-vermilion">Exhibition Room 01</span>
            <span className="text-silver">/</span>
            <span>Continuous synthetic telemetry active across all registered endpoints. Every probe is evaluated against strict latency and body assertions.</span>
          </div>
          <button
            type="button"
            onClick={() => setShowHint(false)}
            className="text-silver transition-colors hover:text-ink"
            aria-label="Dismiss hint"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Hero: Page Header + Kinetic Calder Status Sculpture */}
      <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-[1fr_380px] xl:grid-cols-[1fr_420px]">
        <div>
          <PageHeader
            className="!pt-0"
            eyebrow={
              <span className="flex items-center gap-2.5">
                <HeartbeatRipple beat={globalBeat} tone={toneForStatus(o.systemStatus)} size={6} />
                Live Telemetry · {fleet.total || o.kpis.monitorsTotal} monitors active
              </span>
            }
            title={headline}
            description={
              down.length > 0 ? (
                <>
                  <span className="font-medium text-vermilion">{down.map((m) => m.name).join(", ")}</span> {down.length === 1 ? "is" : "are"} failing synthetic checks
                  {degraded.length > 0 && (
                    <>
                      , and <span className="font-medium text-ochre">{degraded.length}</span> more {degraded.length === 1 ? "is" : "are"} degraded
                    </>
                  )}
                  . Probes are timed server-side with SSRF protection and dispatched through the state machine.
                </>
              ) : degraded.length > 0 ? (
                <>
                  <span className="font-medium text-ochre">{degraded.map((m) => m.name).join(", ")}</span> {degraded.length === 1 ? "is" : "are"} responding with elevated latency.
                </>
              ) : (
                "Every active endpoint answered its probe within expected tolerances. The telemetry engine maintains continuous surveillance."
              )
            }
            actions={
              <>
                <Link href="/status/vigil" className="btn-ghost">
                  Public status <ArrowRight size={13} strokeWidth={1.5} />
                </Link>
                <button type="button" className="btn-primary" onClick={() => setDrawer({ open: true, monitor: null })}>
                  <Plus size={14} strokeWidth={1.5} /> New monitor
                </button>
              </>
            }
          />
        </div>

        {/* Alexander Calder Kinetic Telemetry Totem */}
        <div className="flex justify-center lg:justify-end">
          <KineticStatusTotem
            systemState={o.systemStatus as any}
            monitors={o.monitors}
            globalBeat={globalBeat}
          />
        </div>
      </div>

      {/* Exhibition Placards 01 - 04 */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Key Exhibition Metrics">
        <KpiCard
          index="01"
          statusColor="viridian"
          label="Global Availability · 24h"
          value={<RollingNumber value={k.globalUptime} format={(v: number) => `${v.toFixed(2)}%`} />}
          footnote={`Weighted average across ${k.monitorsActive} active monitors`}
        />
        <KpiCard
          index="02"
          statusColor="ultramarine"
          label="Median Fleet Latency"
          value={<RollingNumber value={k.medianP95} format={(v: number) => `${Math.round(v)}ms`} />}
          footnote="Median of all 24h p95 monitor benchmarks"
        />
        <KpiCard
          index="03"
          statusColor={k.activeIncidents > 0 ? "vermilion" : "viridian"}
          label="Active Incidents"
          value={<RollingNumber value={k.activeIncidents} />}
          footnote={
            <Link href="/incidents" className="font-medium text-ink transition-colors hover:text-vermilion">
              {k.activeIncidents > 0 ? "Inspect incident room →" : "All services operational →"}
            </Link>
          }
        />
        <KpiCard
          index="04"
          statusColor="ochre"
          label="Webhook Ingest · 24h"
          value={<RollingNumber value={k.webhooks24h} />}
          footnote={
            k.webhooksPrev24h > 0
              ? `${k.webhooks24h >= k.webhooksPrev24h ? "+" : "−"}${Math.abs(Math.round(((k.webhooks24h - k.webhooksPrev24h) / k.webhooksPrev24h) * 100))}% vs previous cycle`
              : "Continuous capture buffer active"
          }
        />
      </section>

      {/* Latency Chart + Incident Ledger */}
      <section className="grid grid-cols-[minmax(0,1fr)] gap-8 xl:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)]">
        <div className="rounded-[2px] border border-hairline bg-surface p-5 sm:p-6 shadow-placard">
          <SectionHeading
            title="Fleet Latency Distribution"
            label={`Multi-percentile telemetry (p50, p95, p99) · ${RANGE_CONFIG[range].label.toLowerCase()}`}
            trailing={<SegmentedTabs ariaLabel="Time range" mono size="sm" items={TIME_RANGES.map((r) => ({ value: r, label: r }))} value={range} onChange={setRange} />}
          />
          <div className="mt-6">
            <LatencyChart series={o.series} range={range} height={300} />
          </div>
        </div>

        <aside className="rounded-[2px] border border-hairline bg-surface p-5 sm:p-6 shadow-placard" aria-label="Recent incident dispatches">
          <SectionHeading title="Recent Incidents" trailing={<Link href="/incidents" className="text-[12px] font-medium text-silver transition-colors hover:text-ink">View all</Link>} />
          <ul className="mt-4 flex flex-col divide-y divide-hairline">
            {o.recentIncidents.length === 0 && (
              <li className="py-12 text-center text-[13px] text-silver">No incidents recorded in current cycle</li>
            )}
            {o.recentIncidents.map((i) => (
              <li key={i.id}>
                <button type="button" onClick={() => setIncidentId(i.id)} className="group w-full py-3.5 text-left transition-colors hover:bg-well/40 px-2 -mx-2 rounded-[2px]">
                  <div className="flex items-center justify-between gap-3">
                    <StatusBadge status={i.status} />
                    <DowntimeCounter startedAt={i.startedAt} resolvedAt={i.resolvedAt} downtimeSec={i.downtimeSec} className="font-mono text-[11px] text-body" />
                  </div>
                  <p className="mt-2 line-clamp-2 text-[13px] font-medium text-ink transition-colors group-hover:text-vermilion">{i.title}</p>
                  <p className="mt-1 font-mono text-[11px] text-silver">
                    {i.monitor.name} · <Time value={i.startedAt} />
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </aside>
      </section>

      {/* Monitor Registry with Chromatic Uptime Strip */}
      <section className="space-y-4">
        <SectionHeading
          title="Monitors Registry"
          label="Individual endpoint health and 24-hour uptime"
          trailing={
            <Link href="/monitors" className="flex items-center gap-1 text-[13px] font-medium text-silver transition-colors hover:text-ink">
              Full registry <ArrowRight size={13} strokeWidth={1.5} />
            </Link>
          }
        />
        <MonitorTable className="shadow-placard" monitors={o.monitors} onEdit={(m) => setDrawer({ open: true, monitor: m })} />
      </section>

      <MonitorDrawer open={drawer.open} monitor={drawer.monitor} onClose={() => setDrawer((d) => ({ ...d, open: false }))} />
      <IncidentTimelineDrawer incidentId={incidentId} onClose={() => setIncidentId(null)} />
    </div>
  );
}
