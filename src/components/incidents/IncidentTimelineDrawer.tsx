"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useTelemetry } from "@/components/providers/TelemetryProvider";
import { Drawer } from "@/components/ui/Drawer";
import { FormError } from "@/components/ui/Field";
import { TONE_RGB, toneForStatus } from "@/components/ui/HeartbeatRipple";
import { StatusBadge, statusLabel } from "@/components/ui/StatusBadge";
import { apiFetch, errorMessage } from "@/lib/client/api";
import type { IncidentDTO, IncidentStatus } from "@/lib/client/types";
import { transitionClassic, useMotionPreset } from "@/lib/motion";
import { cn, formatDateTime, formatDuration } from "@/lib/utils";

interface IncidentResponse {
  incident: IncidentDTO;
  allowedTransitions: IncidentStatus[];
}

/** Live-ticking downtime for an open incident; exact `downtimeSec` once resolved. */
export function DowntimeCounter({ startedAt, resolvedAt, downtimeSec, className }: { startedAt: string; resolvedAt: string | null; downtimeSec: number | null; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (resolvedAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [resolvedAt]);
  const sec = resolvedAt ? (downtimeSec ?? 0) : Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  return (
    <span className={cn("num tabular-nums", !resolvedAt && "text-crit", className)} suppressHydrationWarning>
      {formatDuration(sec)}
    </span>
  );
}

/** Vertical drafting-rule timeline of system and operator updates, newest first. */
export function IncidentTimeline({ updates, className }: { updates: IncidentDTO["updates"]; className?: string }) {
  return (
    <ol className={cn("relative ml-1.5", className)}>
      <span className="absolute bottom-2 left-[3px] top-2 w-px bg-rule" aria-hidden />
      <AnimatePresence initial={false}>
        {[...updates].reverse().map((u) => {
          const rgb = TONE_RGB[toneForStatus(u.status)];
          return (
            <motion.li key={u.id} layout initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0, transition: transitionClassic(0.4) }} className="relative pb-6 pl-7 last:pb-0">
              <span className="absolute left-0 top-[5px] h-[7px] w-[7px] rounded-full ring-4 ring-surface" style={{ backgroundColor: `rgb(${rgb})` }} aria-hidden />
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-[12px] font-medium" style={{ color: `rgb(${rgb})` }}>
                  {statusLabel(u.status)}
                </span>
                <span className="label">{u.author === "SYSTEM" ? "Vigil · automatic" : "Operator"}</span>
                <span className="num ml-auto text-[12px] text-silver">{formatDateTime(u.createdAt)}</span>
              </div>
              <p className="mt-1.5 text-[14px] leading-relaxed text-body">{u.message}</p>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ol>
  );
}

interface IncidentTimelineDrawerProps {
  incidentId: string | null;
  onClose: () => void;
  onChanged?: (incident: IncidentDTO) => void;
}

/**
 * Incident slide-over: header facts, a vertical drafting-rule timeline of
 * system and operator updates, and a composer that can post a note and
 * advance the state machine in one action.
 */
export function IncidentTimelineDrawer({ incidentId, onClose, onChanged }: IncidentTimelineDrawerProps) {
  const { version, bump } = useTelemetry();
  const { titleReveal, staggerContainer } = useMotionPreset();
  const [data, setData] = useState<IncidentResponse | null>(null);
  const [message, setMessage] = useState("");
  const [nextStatus, setNextStatus] = useState<IncidentStatus | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!incidentId) return;
    let cancelled = false;
    apiFetch<IncidentResponse>(`/api/incidents/${incidentId}`)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [incidentId, version]);

  useEffect(() => {
    if (!incidentId) {
      setData(null);
      setMessage("");
      setNextStatus("");
      setError(null);
    }
  }, [incidentId]);

  const post = async () => {
    if (!incidentId || (!message.trim() && !nextStatus)) return;
    setBusy(true);
    setError(null);
    try {
      const res = message.trim()
        ? await apiFetch<IncidentResponse>(`/api/incidents/${incidentId}/updates`, {
            method: "POST",
            json: { message: message.trim(), ...(nextStatus ? { status: nextStatus } : {}) },
          })
        : await apiFetch<IncidentResponse>(`/api/incidents/${incidentId}`, { method: "PATCH", json: { status: nextStatus } });
      setData(res);
      setMessage("");
      setNextStatus("");
      onChanged?.(res.incident);
      bump();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const inc = data?.incident;
  const resolved = inc?.status === "RESOLVED";

  return (
    <Drawer
      open={Boolean(incidentId)}
      onClose={onClose}
      width="lg"
      eyebrow={inc ? `Incident · ${inc.monitor.name}` : "Incident"}
      title={inc?.title ?? (error ? "Unavailable" : "Loading…")}
      footer={
        inc && (
          <div className="flex flex-col gap-3">
            <FormError message={error} />
            <textarea
              className="textarea min-h-[84px] font-sans text-[13px]"
              placeholder={resolved ? "Add a post-incident note…" : "Post an operator update — what you know, what you're doing…"}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void post();
              }}
              aria-label="Operator update"
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                {data!.allowedTransitions.length > 0 && <span className="label mr-1">Advance to</span>}
                {data!.allowedTransitions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setNextStatus((cur) => (cur === s ? "" : s))}
                    aria-pressed={nextStatus === s}
                    className={cn(
                      "rounded-sm border px-2.5 py-1 text-[12px] font-medium transition-colors",
                      nextStatus === s ? "border-copper bg-copper-wash text-copper" : "border-hairline text-silver hover:border-hairline-strong hover:text-ink",
                    )}
                  >
                    {statusLabel(s)}
                  </button>
                ))}
              </div>
              <button type="button" className="btn-primary" disabled={busy || (!message.trim() && !nextStatus)} onClick={post}>
                {busy ? "Posting…" : nextStatus && !message.trim() ? `Mark ${statusLabel(nextStatus).toLowerCase()}` : "Post update"}
              </button>
            </div>
          </div>
        )
      }
    >
      {!inc && error && <FormError message={error} />}
      {inc && (
        <motion.div variants={staggerContainer(0.05, 0.05)} initial="hidden" animate="visible" className="flex flex-col gap-6">
          <motion.dl variants={titleReveal} className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            <div>
              <dt className="label">Status</dt>
              <dd className="mt-1.5">
                <StatusBadge status={inc.status} />
              </dd>
            </div>
            <div>
              <dt className="label">Severity</dt>
              <dd className="mt-1.5">
                <StatusBadge status={inc.severity} />
              </dd>
            </div>
            <div>
              <dt className="label">{resolved ? "Downtime" : "Ongoing for"}</dt>
              <dd className="mt-1.5 text-[18px] text-ink">
                <DowntimeCounter startedAt={inc.startedAt} resolvedAt={inc.resolvedAt} downtimeSec={inc.downtimeSec} />
              </dd>
            </div>
            <div>
              <dt className="label">Started</dt>
              <dd className="num mt-1.5 text-[12px] text-ink">{formatDateTime(inc.startedAt)}</dd>
            </div>
          </motion.dl>

          <motion.div variants={titleReveal} className="h-px bg-rule" />

          <motion.div variants={titleReveal}>
            <IncidentTimeline updates={inc.updates} />
          </motion.div>
        </motion.div>
      )}
    </Drawer>
  );
}
