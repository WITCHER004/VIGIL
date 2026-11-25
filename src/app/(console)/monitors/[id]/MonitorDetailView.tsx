"use client";

import { motion } from "framer-motion";
import { ArrowLeft, Check, Minus, Pause, Pencil, Play, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LatencyChart } from "@/components/charts/LatencyChart";
import { UptimeBarStrip } from "@/components/charts/UptimeBarStrip";
import { InstantSolutionsPanel } from "@/components/diagnostics/InstantSolutionsPanel";
import { DowntimeCounter, IncidentTimelineDrawer } from "@/components/incidents/IncidentTimelineDrawer";
import { CheckLedger } from "@/components/monitors/CheckLedger";
import { MonitorDrawer } from "@/components/monitors/MonitorDrawer";
import { ProbeButton } from "@/components/monitors/ProbeButton";
import { useLiveResource, useTelemetry } from "@/components/providers/TelemetryProvider";
import { AnimatedMetric } from "@/components/ui/AnimatedMetric";
import { CopyField } from "@/components/ui/CopyField";
import { HeartbeatRipple, toneForStatus } from "@/components/ui/HeartbeatRipple";
import { KpiCard } from "@/components/ui/KpiCard";
import { PageHeader, SectionHeading } from "@/components/ui/PageHeader";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Time } from "@/components/ui/Time";
import { apiFetch } from "@/lib/client/api";
import type { MonitorDetailDTO } from "@/lib/client/types";
import { useMotionPreset } from "@/lib/motion";
import { RANGE_CONFIG, TIME_RANGES, utcDayKey, type DailyUptime, type TimeRange } from "@/lib/stats";
import { cn, formatDuration, formatMs } from "@/lib/utils";

const pct = (v: number) => `${v.toFixed(2)}%`;

function Verdict({ ok }: { ok: boolean | null }) {
  if (ok == null)
    return (
      <span className="inline-flex items-center gap-1 text-[12px] font-medium text-silver">
        <Minus size={12} strokeWidth={1.5} /> Not set
      </span>
    );
  return ok ? (
    <span className="inline-flex items-center gap-1 text-[12px] font-medium text-ok">
      <Check size={12} strokeWidth={1.75} /> Pass
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[12px] font-medium text-crit">
      <X size={12} strokeWidth={1.75} /> Fail
    </span>
  );
}

export function MonitorDetailView({ id, initial }: { id: string; initial: MonitorDetailDTO }) {
  const router = useRouter();
  const [range, setRange] = useState<TimeRange>("24H");
  const { pulses, bump } = useTelemetry();
  const { staggerContainer } = useMotionPreset();
  const { data, refresh } = useLiveResource<MonitorDetailDTO>(`/api/monitors/${id}?range=${range}`, [range], initial);
  const [editing, setEditing] = useState(false);
  const [incidentId, setIncidentId] = useState<string | null>(null);
  const [pausing, setPausing] = useState(false);

  const d = data ?? initial;
  const { data: month } = useLiveResource<MonitorDetailDTO>(`/api/monitors/${id}?range=30D`);
  const daily: DailyUptime[] | null = month
    ? month.series.map((p) => {
        const date = utcDayKey(p.t);
        return { date, uptime: p.uptime, checks: p.checks, incidents: month.incidents.filter((i) => utcDayKey(i.startedAt) === date).length };
      })
    : null;
  const m = d.monitor;
  const s = d.stats;
  const last = d.lastCheck;
  const internal = m.url.startsWith("/api/sim/");
  const totalCodes = d.statusCodes.reduce((a, c) => a + c.count, 0);

  const togglePause = async () => {
    setPausing(true);
    try {
      await apiFetch(`/api/monitors/${id}`, { method: "PATCH", json: { isPaused: !m.isPaused } });
      bump();
      refresh();
    } finally {
      setPausing(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1360px]">
      <Link href="/monitors" className="label mt-8 inline-flex items-center gap-1.5 hover:text-ink">
        <ArrowLeft size={12} strokeWidth={1.5} /> All monitors
      </Link>

      <PageHeader
        className="!pt-4"
        eyebrow={
          <span className="flex items-center gap-2.5">
            <HeartbeatRipple beat={pulses[id] ?? 0} tone={toneForStatus(m.status)} size={6} />
            Monitor · {m.method} · every {m.intervalSec}s · timeout {formatMs(m.timeoutMs)}
          </span>
        }
        title={m.name}
        meta={
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={m.status} />
            {m.openIncident && (
              <button type="button" onClick={() => setIncidentId(m.openIncident!.id)} className="text-[13px] text-crit underline decoration-crit/40 underline-offset-4 hover:decoration-crit">
                Incident open for <DowntimeCounter startedAt={m.openIncident.startedAt} resolvedAt={null} downtimeSec={null} />
              </button>
            )}
            {m.lastCheckedAt && (
              <span className="text-[12px] text-silver">
                Last checked <Time value={m.lastCheckedAt} />
              </span>
            )}
          </div>
        }
        actions={
          <>
            <ProbeButton monitorId={id} onResult={() => refresh()} />
            <button type="button" className="btn-ghost" onClick={togglePause} disabled={pausing}>
              {m.isPaused ? <Play size={14} strokeWidth={1.5} /> : <Pause size={14} strokeWidth={1.5} />}
              {m.isPaused ? "Resume" : "Pause"}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setEditing(true)}>
              <Pencil size={14} strokeWidth={1.5} /> Edit
            </button>
          </>
        }
      />

      <div className="mt-6 max-w-2xl">
        <CopyField label={internal ? "Target · internal demo endpoint" : "Target"} value={m.url} />
      </div>

      {/* Instant Solutions & Guided Remediation */}
      {(m.openIncident || m.status === "DOWN" || m.status === "DEGRADED") && (
        <div className="mt-8">
          <InstantSolutionsPanel
            incidentId={m.openIncident?.id}
            onRemediated={() => {
              bump();
              refresh();
            }}
          />
        </div>
      )}

      {/* Range KPIs */}
      <div className="mt-8 flex items-end justify-between gap-4">
        <p className="label">{RANGE_CONFIG[range].label}</p>
        <SegmentedTabs ariaLabel="Time range" mono size="sm" items={TIME_RANGES.map((r) => ({ value: r, label: r }))} value={range} onChange={setRange} />
      </div>
      <motion.section variants={staggerContainer(0.4)} initial="hidden" animate="visible" className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4" aria-label="Range statistics">
        <KpiCard label="Uptime" value={<AnimatedMetric value={s.uptime} format={pct} minChars={8} />} footnote={`${s.checks.toLocaleString()} checks · ${s.failures} failed`} />
        <KpiCard label="p50" value={<AnimatedMetric value={s.p50} format={formatMs} minChars={7} />} footnote={`mean ${formatMs(s.mean)}`} />
        <KpiCard label="p95" value={<AnimatedMetric value={s.p95} format={formatMs} minChars={7} />} footnote={`min ${formatMs(s.min)}`} />
        <KpiCard label="p99" value={<AnimatedMetric value={s.p99} format={formatMs} minChars={7} />} footnote={`max ${formatMs(s.max)}`} />
      </motion.section>

      <section className="panel mt-8 p-5 sm:p-6">
        <SectionHeading title="Uptime · last 30 days" label="One bar per UTC day · hover for checks and incidents" />
        <div className="mt-6">{daily ? <UptimeBarStrip days={daily} /> : <div className="h-[60px] animate-pulse rounded-md bg-well" aria-hidden />}</div>
      </section>

      <section className="panel mt-8 p-5 sm:p-6">
        <SectionHeading
          title="Latency"
          label={`p50, p95 and p99 · ${RANGE_CONFIG[range].label.toLowerCase()}`}
        />
        <div className="mt-6">
          <LatencyChart series={d.series} range={range} height={300} />
        </div>
      </section>

      <section className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        {/* Assertion inspector */}
        <div className="panel p-5 sm:p-6">
          <SectionHeading title="Last check" trailing={last ? <span className="num text-[12px] text-silver"><Time value={last.checkedAt} mode="datetime" /></span> : null} />
          <dl className="mt-5 divide-y divide-hairline border-y border-hairline">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 py-3.5">
                <dt className="col-start-1 text-[13px] text-ink">Status code</dt>
                <dd className="col-start-1 num mt-0.5 text-[12px] text-silver">
                  expected <span className="text-ink">{m.expectedStatus}</span> · received{" "}
                  <span className={last?.statusOk ? "text-ink" : "text-crit"}>{last?.statusCode ?? "no response"}</span>
                </dd>
              <dd className="col-start-2 row-span-2 row-start-1 self-center"><Verdict ok={last ? last.statusOk : null} /></dd>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 py-3.5">
                <dt className="col-start-1 text-[13px] text-ink">Body contains</dt>
                <dd className="col-start-1 num mt-0.5 truncate text-[12px] text-silver">{m.bodyContains ? <span className="text-body">{m.bodyContains}</span> : "no body assertion"}</dd>
              <dd className="col-start-2 row-span-2 row-start-1 self-center"><Verdict ok={last ? last.bodyOk : null} /></dd>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 py-3.5">
                <dt className="col-start-1 text-[13px] text-ink">Latency</dt>
                <dd className="col-start-1 num mt-0.5 text-[12px] text-silver">
                  {formatMs(last?.latencyMs)} against a {formatMs(m.degradedThresholdMs)} threshold
                </dd>
              <dd className="col-start-2 row-span-2 row-start-1 self-center"><Verdict ok={last ? last.ok && last.latencyMs <= m.degradedThresholdMs : null} /></dd>
            </div>
            <div className="py-3.5">
              <dt className="col-start-1 text-[13px] text-ink">Failure streak</dt>
              <dd className="col-start-1 num mt-0.5 text-[12px] text-silver">
                {m.consecutiveFailures} consecutive failure{m.consecutiveFailures === 1 ? "" : "s"} · incident opens at 3
              </dd>
            </div>
          </dl>
          {last?.error && <p className="num mt-4 border border-crit/30 bg-crit/[0.06] px-3 py-2 text-[12px] text-crit">{last.error}</p>}

          <p className="label mb-3 mt-6">Response codes · {range}</p>
          <div className="flex flex-col gap-2">
            {d.statusCodes.map((c) => {
              const share = totalCodes ? (c.count / totalCodes) * 100 : 0;
              const good = c.statusCode === m.expectedStatus;
              return (
                <div key={String(c.statusCode)} className="grid grid-cols-[64px_minmax(0,1fr)_88px] items-center gap-3 text-[12px]">
                  <span className={cn("num", good ? "text-ink" : "text-crit")}>{c.statusCode ?? "timeout"}</span>
                  <span className="h-1.5 bg-silver/10">
                    <motion.span
                      className={cn("block h-full", good ? "bg-silver/60" : "bg-crit")}
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.max(share, 0.6)}%` }}
                      transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                    />
                  </span>
                  <span className="num text-right text-silver">
                    {c.count.toLocaleString()} · {share.toFixed(1)}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Incidents */}
        <div className="panel flex flex-col p-5 sm:p-6">
          <SectionHeading title="Incidents" />
          <ul className="mt-4 flex-1 divide-y divide-hairline">
            {d.incidents.length === 0 && <li className="py-10 text-center text-[13px] text-silver">No incidents for this monitor</li>}
            {d.incidents.map((i) => (
              <li key={i.id}>
                <button type="button" onClick={() => setIncidentId(i.id)} className="group w-full py-3.5 text-left">
                  <div className="flex items-center justify-between gap-3">
                    <StatusBadge status={i.status} />
                    <span className="text-[12px] text-body">
                      {i.resolvedAt ? formatDuration(i.downtimeSec) : <DowntimeCounter startedAt={i.startedAt} resolvedAt={null} downtimeSec={null} />}
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-[13px] text-ink transition-colors group-hover:text-ink">{i.title}</p>
                  <p className="mt-1 text-[12px] text-silver">
                    <Time value={i.startedAt} mode="datetime" /> · {i.updates.length} updates
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mt-10">
        <SectionHeading title="Check runs" className="mb-4" />
        <CheckLedger monitorId={id} degradedThresholdMs={m.degradedThresholdMs} />
      </section>

      <MonitorDrawer
        open={editing}
        monitor={m}
        onClose={() => setEditing(false)}
        onSaved={() => refresh()}
        onDeleted={() => router.push("/monitors")}
      />
      <IncidentTimelineDrawer incidentId={incidentId} onClose={() => setIncidentId(null)} onChanged={() => refresh()} />
    </div>
  );
}
