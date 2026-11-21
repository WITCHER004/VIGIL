"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, MessageSquarePlus, Wrench } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { DowntimeCounter, IncidentTimeline, IncidentTimelineDrawer } from "@/components/incidents/IncidentTimelineDrawer";
import { useLiveResource } from "@/components/providers/TelemetryProvider";
import { TONE_RGB, toneForStatus } from "@/components/ui/HeartbeatRipple";
import { PageHeader } from "@/components/ui/PageHeader";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Time } from "@/components/ui/Time";
import type { IncidentDTO } from "@/lib/client/types";
import { transitionClassic } from "@/lib/motion";
import { INCIDENT_POLICY } from "@/lib/stats";
import { cn, formatDuration } from "@/lib/utils";

type Filter = "active" | "resolved" | "all";
type ListDTO = { incidents: IncidentDTO[]; counts: Record<Filter, number> };

export function IncidentsView({ initial }: { initial: ListDTO }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [monitorId, setMonitorId] = useState("");
  const [expanded, setExpanded] = useState<string | null>(initial.incidents.find((i) => i.status !== "RESOLVED")?.id ?? null);
  const [drawerId, setDrawerId] = useState<string | null>(null);

  const query = `/api/incidents?status=${filter}${monitorId ? `&monitorId=${monitorId}` : ""}`;
  const { data } = useLiveResource<ListDTO>(query, [query], filter === "all" && !monitorId ? initial : null);
  const list = data ?? initial;

  // Monitor filter options come from the unfiltered initial set plus anything loaded since.
  const monitors = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of [...initial.incidents, ...list.incidents]) map.set(i.monitor.id, i.monitor.name);
    return [...map].sort((a, b) => a[1].localeCompare(b[1]));
  }, [initial, list]);

  const totalDowntime = list.incidents.reduce((acc, i) => acc + (i.downtimeSec ?? 0), 0);

  return (
    <div className="mx-auto max-w-[1180px]">
      <PageHeader
        eyebrow="Exhibition Room 04 · Incident Telemetry"
        title="Incidents"
        description={`Opened automatically after ${INCIDENT_POLICY.failureThreshold} consecutive failed checks and resolved after ${INCIDENT_POLICY.recoveryThreshold} consecutive successes. Operators move incidents forward (Investigating → Identified → Resolved) and leave timeline notes as they work.`}
        meta={
          <p className="num text-[12px] text-silver">
            {list.counts.active} active · {list.counts.resolved} resolved · {formatDuration(totalDowntime)} recorded downtime in view
          </p>
        }
      />

      <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <SegmentedTabs<Filter>
          ariaLabel="Filter incidents"
          value={filter}
          onChange={setFilter}
          items={[
            { value: "all", label: "All", count: list.counts.all },
            { value: "active", label: "Active", count: list.counts.active },
            { value: "resolved", label: "Resolved", count: list.counts.resolved },
          ]}
        />
        <label className="flex items-center gap-2.5">
          <span className="label">Monitor</span>
          <select className="select w-[220px] font-sans" value={monitorId} onChange={(e) => setMonitorId(e.target.value)}>
            <option value="">All monitors</option>
            {monitors.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ol className="mt-6 flex flex-col gap-3">
        {list.incidents.length === 0 && (
          <li className="panel px-6 py-16 text-center">
            <p className="text-[15px] text-body">{filter === "active" ? "No active incidents" : "No incidents match this filter"}</p>
            <p className="mt-2 text-[13px] text-silver/70">Use the simulator dock to push a mock service into outage and watch one open</p>
          </li>
        )}
        <AnimatePresence initial={false}>
          {list.incidents.map((inc) => {
            const open = expanded === inc.id;
            const active = inc.status !== "RESOLVED";
            const rgb = TONE_RGB[toneForStatus(inc.status)];
            return (
              <motion.li
                key={inc.id}
                layout="position"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0, transition: transitionClassic(0.4) }}
                exit={{ opacity: 0, transition: transitionClassic(0.2) }}
                className={cn(
                  "panel border-l-[3px] shadow-placard transition-colors",
                  active ? "border-l-vermilion" : "border-l-viridian",
                )}
              >
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : inc.id)}
                  aria-expanded={open}
                  className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-x-6 gap-y-3 px-5 py-4 text-left transition-colors hover:bg-well/40 sm:grid-cols-[minmax(0,1fr)_150px_120px_20px] sm:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={inc.status} />
                      <StatusBadge status={inc.severity} />
                    </div>
                    <p className="mt-2 text-[15px] font-medium leading-snug text-ink">{inc.title}</p>
                    <p className="mt-1 font-mono text-[11px] text-silver">
                      <Link href={`/monitors/${inc.monitor.id}`} onClick={(e) => e.stopPropagation()} className="hover:text-ink">
                        {inc.monitor.name}
                      </Link>{" "}
                      · started <Time value={inc.startedAt} mode="datetime" />
                    </p>
                  </div>
                  <div className="hidden sm:block">
                    <p className="label">{active ? "Ongoing" : "Downtime"}</p>
                    <p className="mt-1 font-mono text-[17px] text-ink">
                      <DowntimeCounter startedAt={inc.startedAt} resolvedAt={inc.resolvedAt} downtimeSec={inc.downtimeSec} />
                    </p>
                  </div>
                  <div className="hidden sm:block">
                    <p className="label">Updates</p>
                    <p className="num mt-1 font-mono text-[17px] text-ink">{inc.updates.length}</p>
                  </div>
                  <ChevronDown size={16} strokeWidth={1.5} className={cn("mt-1 text-silver transition-transform duration-200 ease-gallery sm:mt-0", open && "rotate-180")} />
                </button>

                <AnimatePresence initial={false}>
                  {open && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={transitionClassic(0.35)} className="overflow-hidden">
                      <div className="border-t border-hairline px-5 pb-5 pt-5 sm:pl-8">
                        <div className="mb-5 flex items-center justify-between gap-3 sm:hidden">
                          <span className="text-[12px] text-silver">{active ? "Ongoing" : "Downtime"}</span>
                          <DowntimeCounter startedAt={inc.startedAt} resolvedAt={inc.resolvedAt} downtimeSec={inc.downtimeSec} className="text-[14px] text-ink" />
                        </div>
                        <IncidentTimeline updates={inc.updates} />
                        <div className="mt-5 flex flex-wrap items-center justify-end gap-2.5">
                          <button
                            type="button"
                            className="btn-ghost"
                            onClick={() => setDrawerId(inc.id)}
                          >
                            <Wrench size={13} className="text-vermilion" strokeWidth={1.75} />
                            <span>Instant Solutions &amp; Runbook</span>
                          </button>
                          <button
                            type="button"
                            className={active ? "btn-primary" : "btn-ghost"}
                            onClick={() => setDrawerId(inc.id)}
                          >
                            <MessageSquarePlus size={14} strokeWidth={1.5} />
                            {active ? "Post update" : "Add note"}
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ol>

      <IncidentTimelineDrawer incidentId={drawerId} onClose={() => setDrawerId(null)} />
    </div>
  );
}
