"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, ClipboardCopy, MessageSquarePlus } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { InstantSolutionsPanel } from "@/components/diagnostics/InstantSolutionsPanel";
import { DowntimeCounter, IncidentTimeline, IncidentTimelineDrawer } from "@/components/incidents/IncidentTimelineDrawer";
import { useLiveResource, useTelemetry } from "@/components/providers/TelemetryProvider";
import { PageHeader, SectionHeading } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Time } from "@/components/ui/Time";
import { apiFetch, errorMessage } from "@/lib/client/api";
import type { IncidentDTO } from "@/lib/client/types";
import { transitionClassic } from "@/lib/motion";
import { INCIDENT_POLICY } from "@/lib/stats";
import { cn, formatDuration } from "@/lib/utils";

type ListDTO = { incidents: IncidentDTO[]; counts: Record<"active" | "resolved" | "all", number> };

/** Generates the Markdown postmortem server-side and copies it; the icon morphs to a check on success. */
function CopyPostmortemButton({ incidentId }: { incidentId: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const copy = async () => {
    setState("busy");
    try {
      const res = await apiFetch<{ markdown: string }>(`/api/incidents/${incidentId}/postmortem`, { method: "POST" });
      await navigator.clipboard.writeText(res.markdown);
      setState("done");
      window.setTimeout(() => setState("idle"), 2000);
    } catch (err) {
      setError(errorMessage(err));
      setState("error");
    }
  };
  return (
    <span className="inline-flex items-center gap-2">
      {state === "error" && error && <span className="text-[12px] text-crit">{error}</span>}
      <button type="button" onClick={copy} disabled={state === "busy"} className="btn-ghost">
        {state === "done" ? <Check size={14} strokeWidth={2} className="text-ok" /> : <ClipboardCopy size={14} strokeWidth={1.75} />}
        {state === "done" ? "Copied" : state === "busy" ? "Generating…" : "Copy postmortem"}
      </button>
    </span>
  );
}

/** `linkMonitor` is off inside clickable rows: a link nested in a button is invalid and confuses keyboard/screen-reader users. */
function IncidentHeader({ inc, linkMonitor = true }: { inc: IncidentDTO; linkMonitor?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={inc.status} />
        <StatusBadge status={inc.severity} />
      </div>
      <p className="mt-2 text-[15px] font-medium leading-snug text-ink">{inc.title}</p>
      <p className="mt-1 text-[12px] text-silver">
        {linkMonitor ? (
          <Link href={`/monitors/${inc.monitor.id}`} className="hover:text-ink">
            {inc.monitor.name}
          </Link>
        ) : (
          inc.monitor.name
        )}{" "}
        · started <Time value={inc.startedAt} mode="datetime" />
      </p>
    </div>
  );
}

export function IncidentsView({ initial }: { initial: ListDTO }) {
  const { bump } = useTelemetry();
  const [monitorId, setMonitorId] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [drawerId, setDrawerId] = useState<string | null>(null);

  const query = `/api/incidents?status=all${monitorId ? `&monitorId=${monitorId}` : ""}`;
  const { data } = useLiveResource<ListDTO>(query, [query], monitorId ? null : initial);
  const list = data ?? initial;
  const active = list.incidents.filter((i) => i.status !== "RESOLVED");
  const resolved = list.incidents.filter((i) => i.status === "RESOLVED");
  const totalDowntime = resolved.reduce((acc, i) => acc + (i.downtimeSec ?? 0), 0);

  // Monitor filter options: the unfiltered initial set plus anything loaded since.
  const monitors = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of [...initial.incidents, ...list.incidents]) map.set(i.monitor.id, i.monitor.name);
    return [...map].sort((a, b) => a[1].localeCompare(b[1]));
  }, [initial, list]);

  return (
    <div className="mx-auto max-w-[1180px] space-y-10">
      <PageHeader
        eyebrow="Incident log"
        title="Incidents"
        description={`Opened after ${INCIDENT_POLICY.failureThreshold} consecutive failed checks, resolved after ${INCIDENT_POLICY.recoveryThreshold} consecutive successes. Move incidents from Investigating to Identified to Resolved and leave notes as you work.`}
        meta={
          <p className="num text-[12px] text-silver">
            {active.length} active · {resolved.length} resolved · {formatDuration(totalDowntime)} recorded downtime
          </p>
        }
        actions={
          <label className="flex items-center gap-2.5">
            <span className="label">Monitor</span>
            <select className="select w-[220px]" value={monitorId} onChange={(e) => setMonitorId(e.target.value)} aria-label="Filter incidents by monitor">
              <option value="">All monitors</option>
              {monitors.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        }
      />

      {/* Active */}
      <section className="space-y-4" aria-label="Active incidents">
        <SectionHeading title="Active" label={active.length ? "Live downtime, guided fixes and runbooks" : undefined} trailing={<span className="num text-[13px] text-silver">{active.length}</span>} />
        {active.length === 0 ? (
          <div className="panel px-6 py-12 text-center">
            <p className="text-[15px] text-ink">No active incidents</p>
            <p className="mt-1 text-[13px] text-silver">Push a demo service into outage from Live demo controls to watch one open.</p>
          </div>
        ) : (
          <ol className="space-y-4">
            <AnimatePresence initial={false}>
              {active.map((inc) => (
                <motion.li
                  key={inc.id}
                  layout="position"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0, transition: transitionClassic(0.4) }}
                  exit={{ opacity: 0, transition: transitionClassic(0.2) }}
                  className="panel border-l-2 border-l-crit"
                >
                  <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
                    <IncidentHeader inc={inc} />
                    <div className="flex shrink-0 items-center gap-5">
                      <div>
                        <p className="label">Ongoing</p>
                        <p className="mt-1 font-mono text-[18px] text-crit">
                          <DowntimeCounter startedAt={inc.startedAt} resolvedAt={null} downtimeSec={null} />
                        </p>
                      </div>
                      <button type="button" className="btn-primary" onClick={() => setDrawerId(inc.id)}>
                        <MessageSquarePlus size={14} strokeWidth={1.75} />
                        Post update
                      </button>
                    </div>
                  </div>
                  <div className="border-t border-hairline p-5">
                    <InstantSolutionsPanel incidentId={inc.id} onRemediated={bump} className="!rounded-none !border-0 !bg-transparent !p-0 !shadow-none" />
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          </ol>
        )}
      </section>

      {/* Resolved archive */}
      <section className="space-y-4" aria-label="Resolved incidents">
        <SectionHeading title="Resolved archive" trailing={<span className="num text-[13px] text-silver">{resolved.length}</span>} />
        {resolved.length === 0 ? (
          <div className="panel px-6 py-10 text-center text-[13px] text-silver">No resolved incidents yet.</div>
        ) : (
          <ol className="panel divide-y divide-hairline">
            {resolved.map((inc) => {
              const open = expanded === inc.id;
              return (
                <li key={inc.id}>
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : inc.id)}
                    aria-expanded={open}
                    className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-3 px-5 py-4 text-left transition-colors hover:bg-raised sm:grid-cols-[minmax(0,1fr)_130px_20px]"
                  >
                    <IncidentHeader inc={inc} linkMonitor={false} />
                    <span className="hidden sm:block">
                      <span className="label block">Downtime</span>
                      <span className="mt-1 inline-block rounded-sm bg-well px-1.5 py-0.5 font-mono text-[13px] text-ink">{formatDuration(inc.downtimeSec)}</span>
                    </span>
                    <ChevronDown size={16} strokeWidth={1.75} className={cn("text-silver transition-transform duration-200", open && "rotate-180")} />
                  </button>
                  <AnimatePresence initial={false}>
                    {open && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={transitionClassic(0.35)} className="overflow-hidden">
                        <div className="border-t border-hairline bg-canvas/50 px-5 py-5 sm:pl-8">
                          <IncidentTimeline updates={inc.updates} />
                          <div className="mt-5 flex flex-wrap items-center justify-end gap-2.5">
                            <CopyPostmortemButton incidentId={inc.id} />
                            <button type="button" className="btn-ghost" onClick={() => setDrawerId(inc.id)}>
                              <MessageSquarePlus size={14} strokeWidth={1.75} />
                              Add note
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <IncidentTimelineDrawer incidentId={drawerId} onClose={() => setDrawerId(null)} />
    </div>
  );
}
