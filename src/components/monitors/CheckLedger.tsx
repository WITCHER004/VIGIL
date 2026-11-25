"use client";

import type { CheckRun } from "@prisma/client";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Minus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTelemetry } from "@/components/providers/TelemetryProvider";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { Time } from "@/components/ui/Time";
import { apiFetch } from "@/lib/client/api";
import type { Serialized } from "@/lib/client/types";
import { transitionClassic } from "@/lib/motion";
import { cn, formatMs } from "@/lib/utils";

type CheckDTO = Serialized<CheckRun>;
type Filter = "all" | "failed";
const PAGE = 25;

function Assert({ value }: { value: boolean | null }) {
  if (value == null) return <Minus size={13} strokeWidth={1.5} className="text-silver" aria-label="not asserted" />;
  return value ? <Check size={13} strokeWidth={1.75} className="text-ok" aria-label="passed" /> : <X size={13} strokeWidth={1.75} className="text-crit" aria-label="failed" />;
}

/**
 * Paginated check ledger. Cursor pagination for history; new checks from live
 * sweeps / manual probes are merged at the top (with a brief copper flash)
 * whenever telemetry reports fresh data.
 */
export function CheckLedger({ monitorId, degradedThresholdMs }: { monitorId: string; degradedThresholdMs: number }) {
  const { version } = useTelemetry();
  const [filter, setFilter] = useState<Filter>("all");
  const [rows, setRows] = useState<CheckDTO[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const known = useRef<Set<string>>(new Set());

  const status = filter === "failed" ? "failed" : "all";

  // First page — on mount, filter change and every telemetry bump (merge, don't replace).
  const loadHead = useCallback(
    async (reset: boolean) => {
      const res = await apiFetch<{ checks: CheckDTO[]; total: number; nextCursor: string | null }>(
        `/api/monitors/${monitorId}/checks?limit=${PAGE}&status=${status}`,
      );
      setTotal(res.total);
      if (reset) {
        known.current = new Set(res.checks.map((c) => c.id));
        setRows(res.checks);
        setCursor(res.nextCursor);
        setFresh(new Set());
        return;
      }
      const incoming = res.checks.filter((c) => !known.current.has(c.id));
      if (incoming.length === 0) return;
      for (const c of incoming) known.current.add(c.id);
      setFresh(new Set(incoming.map((c) => c.id)));
      setRows((prev) => [...incoming, ...prev]);
    },
    [monitorId, status],
  );

  useEffect(() => {
    loadHead(true).catch(() => {});
  }, [loadHead]);

  useEffect(() => {
    if (version > 0) loadHead(false).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const res = await apiFetch<{ checks: CheckDTO[]; nextCursor: string | null }>(
        `/api/monitors/${monitorId}/checks?limit=${PAGE}&status=${status}&cursor=${cursor}`,
      );
      const older = res.checks.filter((c) => !known.current.has(c.id));
      for (const c of older) known.current.add(c.id);
      setRows((prev) => [...prev, ...older]);
      setCursor(res.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SegmentedTabs<Filter>
          ariaLabel="Filter checks"
          size="sm"
          value={filter}
          onChange={setFilter}
          items={[
            { value: "all", label: "All checks" },
            { value: "failed", label: "Failures only" },
          ]}
        />
        <p className="num text-[12px] text-silver">
          {total == null ? "—" : `${rows.length.toLocaleString()} of ${total.toLocaleString()}`}
        </p>
      </div>

      <div className="panel mt-3 overflow-x-auto">
        <table className="w-full min-w-[860px] text-left">
          <thead>
            <tr className="label border-b border-hairline">
              <th className="py-2.5 pl-5 pr-3 font-medium">Checked</th>
              <th className="px-3 py-2.5 font-medium">Result</th>
              <th className="px-3 py-2.5 text-right font-medium">HTTP</th>
              <th className="px-3 py-2.5 text-right font-medium">Latency</th>
              <th className="px-3 py-2.5 text-center font-medium">Status</th>
              <th className="px-3 py-2.5 text-center font-medium">Body</th>
              <th className="px-3 py-2.5 font-medium">Source</th>
              <th className="py-2.5 pl-3 pr-5 font-medium">Detail</th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence initial={false}>
              {rows.map((c) => {
                const slow = c.ok && c.latencyMs > degradedThresholdMs;
                return (
                  <motion.tr
                    key={c.id}
                    layout="position"
                    initial={fresh.has(c.id) ? { opacity: 0, backgroundColor: "rgb(232 116 59 / 0.12)" } : false}
                    animate={{ opacity: 1, backgroundColor: "rgb(232 116 59 / 0)", transition: { opacity: transitionClassic(0.35), backgroundColor: { duration: 1.2 } } }}
                    className="num border-b border-hairline/60 text-[12px] last:border-0"
                  >
                    <td className="whitespace-nowrap py-2 pl-5 pr-3 text-body">
                      <Time value={c.checkedAt} mode="datetime" />
                    </td>
                    <td className="px-3 py-2">
                      <span className={cn("inline-flex items-center gap-1.5", c.ok ? (slow ? "text-warn" : "text-ok") : "text-crit")}>
                        <span className="dot bg-current" />
                        {c.ok ? (slow ? "SLOW" : "OK") : "FAIL"}
                      </span>
                    </td>
                    <td className={cn("px-3 py-2 text-right", c.statusOk ? "text-ink" : "text-crit")}>{c.statusCode ?? "—"}</td>
                    <td className={cn("px-3 py-2 text-right", slow ? "text-warn" : "text-ink")}>{formatMs(c.latencyMs)}</td>
                    <td className="px-3 py-2">
                      <span className="flex justify-center">
                        <Assert value={c.statusOk} />
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex justify-center">
                        <Assert value={c.bodyOk} />
                      </span>
                    </td>
                    <td className="px-3 py-2 text-silver">{c.source}</td>
                    <td className="max-w-[320px] truncate py-2 pl-3 pr-5 text-[12px] text-crit" title={c.error ?? undefined}>
                      {c.error ?? ""}
                    </td>
                  </motion.tr>
                );
              })}
            </AnimatePresence>
            {rows.length === 0 && total === 0 && (
              <tr>
                <td colSpan={8} className="px-5 py-10 text-center font-sans text-[13px] text-silver">
                  {filter === "failed" ? "No failed checks on record." : "No checks yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {cursor && (
        <div className="mt-4 flex justify-center">
          <button type="button" className="btn-ghost" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "Loading…" : `Load ${PAGE} older checks`}
          </button>
        </div>
      )}
    </div>
  );
}
