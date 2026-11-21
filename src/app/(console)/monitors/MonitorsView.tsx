"use client";

import { Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { MonitorDrawer } from "@/components/monitors/MonitorDrawer";
import { MonitorTable } from "@/components/monitors/MonitorTable";
import { useLiveResource } from "@/components/providers/TelemetryProvider";
import { PageHeader } from "@/components/ui/PageHeader";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import type { MonitorSummary } from "@/lib/client/types";
import { INCIDENT_POLICY } from "@/lib/stats";

type Filter = "all" | "OPERATIONAL" | "DEGRADED" | "DOWN" | "PAUSED";

export function MonitorsView({ initial }: { initial: { monitors: MonitorSummary[] } }) {
  const { data, refresh } = useLiveResource<{ monitors: MonitorSummary[] }>("/api/monitors", [], initial);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [drawer, setDrawer] = useState<{ open: boolean; monitor: MonitorSummary | null }>({ open: false, monitor: null });

  const monitors = (data ?? initial).monitors;
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: monitors.length, OPERATIONAL: 0, DEGRADED: 0, DOWN: 0, PAUSED: 0 };
    for (const m of monitors) if (m.status in c) c[m.status as Filter]++;
    return c;
  }, [monitors]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return monitors.filter(
      (m) => (filter === "all" || m.status === filter) && (!q || m.name.toLowerCase().includes(q) || m.url.toLowerCase().includes(q)),
    );
  }, [monitors, filter, query]);

  return (
    <div className="mx-auto max-w-[1440px]">
      <PageHeader
        eyebrow="Synthetic monitoring"
        title="Monitors"
        description={`Each endpoint is probed server-side on its own interval through an SSRF-pinned client. Status, body and latency assertions are evaluated per check; ${INCIDENT_POLICY.failureThreshold} consecutive failures open an incident and ${INCIDENT_POLICY.recoveryThreshold} consecutive successes resolve it.`}
        actions={
          <button type="button" className="btn-primary" onClick={() => setDrawer({ open: true, monitor: null })}>
            <Plus size={14} strokeWidth={1.5} /> New monitor
          </button>
        }
      />

      <div className="mt-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <SegmentedTabs<Filter>
          ariaLabel="Filter monitors by status"
          className="overflow-x-auto"
          value={filter}
          onChange={setFilter}
          items={[
            { value: "all", label: "All", count: counts.all },
            { value: "OPERATIONAL", label: "Operational", count: counts.OPERATIONAL },
            { value: "DEGRADED", label: "Degraded", count: counts.DEGRADED },
            { value: "DOWN", label: "Down", count: counts.DOWN },
            { value: "PAUSED", label: "Paused", count: counts.PAUSED },
          ]}
        />
        <label className="relative block w-full lg:w-[300px]">
          <span className="sr-only">Search monitors</span>
          <Search size={14} strokeWidth={1.5} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-silver/70" />
          <input className="input pl-9 font-sans" placeholder="Search name or URL" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>

      <MonitorTable
        className="mt-5"
        variant="full"
        monitors={visible}
        onEdit={(m) => setDrawer({ open: true, monitor: m })}
        onChanged={refresh}
        emptyMessage={query || filter !== "all" ? "No monitors match this filter." : "No monitors yet — create one to start probing."}
      />

      <MonitorDrawer open={drawer.open} monitor={drawer.monitor} onClose={() => setDrawer((d) => ({ ...d, open: false }))} onSaved={refresh} onDeleted={refresh} />
    </div>
  );
}
