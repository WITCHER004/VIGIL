"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Plus, RotateCcw, Webhook } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTelemetry } from "@/components/providers/TelemetryProvider";
import { InstantSolutionsPanel } from "@/components/diagnostics/InstantSolutionsPanel";
import { CopyField } from "@/components/ui/CopyField";
import { FormError } from "@/components/ui/Field";
import { HeartbeatRipple, toneForStatus, TONE_RGB } from "@/components/ui/HeartbeatRipple";
import { JsonView } from "@/components/ui/JsonView";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { apiFetch, errorMessage } from "@/lib/client/api";
import type { EndpointDetailDTO, EventDetailDTO, EventSummaryDTO, ReplayDTO, SerializedEndpoint } from "@/lib/client/types";
import { transitionClassic, useMotionPreset } from "@/lib/motion";
import { cn, formatBytes, formatDateTime, formatMs, formatRelative } from "@/lib/utils";
import { SIGNATURE_SCHEMES } from "@/lib/validation";
import { ReplayPanel } from "./ReplayPanel";

const STREAM_POLL_MS = 3_000;
const METER_POLL_MS = 4_000;
const ENDPOINT_KEY = "vigil:endpoint";

const SIGNATURE_COPY: Record<string, string> = {
  VALID: "HMAC-SHA256 signature verified against this endpoint's secret.",
  INVALID: "Signature present but does not match — wrong secret, tampered body, or stale timestamp.",
  MISSING: "Endpoint expects a signature, but the request carried none.",
  UNCHECKED: "Endpoint has no signing scheme; payload accepted without verification.",
};

type DetailTab = "payload" | "headers" | "replays";

const SCHEME_NAME: Record<string, string> = { NONE: "Unsigned", STRIPE: "Stripe", GITHUB: "GitHub", RAZORPAY: "Razorpay", GENERIC: "Generic" };

/** Ticks at the given interval so relative timestamps stay honest. */
function useNow(intervalMs = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

// ─── Rate-limit meter ─────────────────────────────────────────────────────────

function RateMeter({ meter }: { meter: EndpointDetailDTO["rateLimit"] | null }) {
  if (!meter) return <div className="h-[46px]" />;
  const cells = Math.min(meter.limit, 40);
  const filled = Math.round((meter.remaining / meter.limit) * cells);
  const low = meter.remaining / meter.limit < 0.2;
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <p className="label">Token bucket</p>
        <p className="num text-[12px] text-silver">
          <span className={cn("text-ink", low && "text-warn")}>{meter.remaining}</span>/{meter.limit} · +{meter.refillPerSec}/s
        </p>
      </div>
      <div className="flex gap-[2px]" role="meter" aria-valuemin={0} aria-valuemax={meter.limit} aria-valuenow={meter.remaining} aria-label="Ingest rate limit tokens remaining">
        {Array.from({ length: cells }, (_, i) => (
          <span
            key={i}
            className={cn(
              "h-2.5 flex-1 rounded-[1px] transition-colors duration-500 ease-classic",
              i < filled ? (low ? "bg-warn" : "bg-silver/55") : "bg-silver/10",
            )}
          />
        ))}
      </div>
      <p className="mt-1.5 text-[12px] text-silver/70">
        Excess requests receive <span className="num">429</span> + <span className="num">Retry-After</span> · {meter.backend === "upstash" ? "Upstash Redis" : "in-memory"} backend
      </p>
    </div>
  );
}

// ─── New endpoint ─────────────────────────────────────────────────────────────

function NewEndpointForm({ onCreated, onCancel }: { onCreated: (ep: SerializedEndpoint) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [scheme, setScheme] = useState<(typeof SIGNATURE_SCHEMES)[number]>("GENERIC");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ endpoint: SerializedEndpoint & { secret?: string } }>("/api/webhooks", {
        method: "POST",
        json: { name: name || "Untitled endpoint", signatureScheme: scheme },
      });
      onCreated(res.endpoint);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={transitionClassic(0.35)} className="overflow-hidden">
      <div className="mt-3 flex flex-col gap-2.5 border border-hairline bg-well/60 p-3">
        <input className="input font-sans" placeholder="Endpoint name" value={name} onChange={(e) => setName(e.target.value)} autoFocus aria-label="Endpoint name" />
        <select className="select" value={scheme} onChange={(e) => setScheme(e.target.value as typeof scheme)} aria-label="Signature scheme">
          {SIGNATURE_SCHEMES.map((s) => (
            <option key={s} value={s}>
              {s === "NONE" ? "No signature" : `${s.charAt(0)}${s.slice(1).toLowerCase()} HMAC-SHA256`}
            </option>
          ))}
        </select>
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost h-8" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn-primary h-8" onClick={create} disabled={busy}>
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Inspector ────────────────────────────────────────────────────────────────

export function WebhookInspector({ className }: { className?: string }) {
  const { version, live } = useTelemetry();
  const { feedItem } = useMotionPreset();
  const now = useNow();

  const [origin, setOrigin] = useState("");
  const [endpoints, setEndpoints] = useState<SerializedEndpoint[]>([]);
  const [endpointId, setEndpointId] = useState<string | null>(null);
  const [meter, setMeter] = useState<EndpointDetailDTO | null>(null);
  const [events, setEvents] = useState<EventSummaryDTO[]>([]);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const [cursor, setCursor] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<EventDetailDTO | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [tab, setTab] = useState<DetailTab>("payload");
  const [replayOpen, setReplayOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<{ id: string; secret: string } | null>(null);
  const [streamBeat, setStreamBeat] = useState(0);
  const [expandedReplay, setExpandedReplay] = useState<string | null>(null);

  const latestRef = useRef<string | null>(null);
  const endpointRef = useRef<string | null>(null);
  endpointRef.current = endpointId;

  useEffect(() => setOrigin(window.location.origin), []);

  // Endpoints
  const loadEndpoints = useCallback(async () => {
    const res = await apiFetch<{ endpoints: SerializedEndpoint[] }>("/api/webhooks");
    setEndpoints(res.endpoints);
    setEndpointId((current) => {
      if (current && res.endpoints.some((e) => e.id === current)) return current;
      let saved: string | null = null;
      try {
        saved = window.localStorage.getItem(ENDPOINT_KEY);
      } catch {
        /* ignore */
      }
      return res.endpoints.find((e) => e.id === saved)?.id ?? res.endpoints[0]?.id ?? null;
    });
  }, []);

  useEffect(() => {
    loadEndpoints().catch(() => {});
  }, [loadEndpoints]);

  const selectEndpoint = (id: string) => {
    setEndpointId(id);
    try {
      window.localStorage.setItem(ENDPOINT_KEY, id);
    } catch {
      /* ignore */
    }
  };

  // Initial page of events whenever the endpoint changes
  useEffect(() => {
    if (!endpointId) return;
    let cancelled = false;
    setEvents([]);
    setFresh(new Set());
    setSelectedId(null);
    setDetail(null);
    latestRef.current = null;
    apiFetch<{ events: EventSummaryDTO[]; nextCursor: string | null }>(`/api/webhooks/endpoints/${endpointId}/events?limit=40`)
      .then((res) => {
        if (cancelled) return;
        setEvents(res.events);
        setCursor(res.nextCursor);
        latestRef.current = res.events[0]?.receivedAt ?? new Date(0).toISOString();
        setSelectedId(res.events[0]?.id ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [endpointId]);

  // Rate-limit meter
  const loadMeter = useCallback(async () => {
    const id = endpointRef.current;
    if (!id) return;
    const res = await apiFetch<EndpointDetailDTO>(`/api/webhooks/endpoints/${id}`);
    if (endpointRef.current === id) setMeter(res);
  }, []);

  useEffect(() => {
    setMeter(null);
    loadMeter().catch(() => {});
    const t = window.setInterval(() => !document.hidden && loadMeter().catch(() => {}), METER_POLL_MS);
    return () => window.clearInterval(t);
  }, [endpointId, loadMeter]);

  // Live stream: poll for events newer than the newest we hold
  const pollNew = useCallback(async () => {
    const id = endpointRef.current;
    const after = latestRef.current;
    if (!id || !after) return;
    const res = await apiFetch<{ events: EventSummaryDTO[] }>(
      `/api/webhooks/endpoints/${id}/events?after=${encodeURIComponent(after)}&limit=50`,
    );
    if (endpointRef.current !== id || res.events.length === 0) return;
    latestRef.current = res.events[0]!.receivedAt;
    setEvents((prev) => {
      const known = new Set(prev.map((e) => e.id));
      const incoming = res.events.filter((e) => !known.has(e.id));
      return incoming.length ? [...incoming, ...prev].slice(0, 200) : prev;
    });
    setFresh((prev) => new Set([...prev, ...res.events.map((e) => e.id)]));
    setStreamBeat((b) => b + 1);
    setSelectedId((cur) => cur ?? res.events[0]!.id);
    loadMeter().catch(() => {});
  }, [loadMeter]);

  useEffect(() => {
    if (!live) return;
    const t = window.setInterval(() => !document.hidden && pollNew().catch(() => {}), STREAM_POLL_MS);
    return () => window.clearInterval(t);
  }, [live, pollNew]);

  // Simulator / other actions bump telemetry → check immediately
  useEffect(() => {
    if (version === 0) return;
    pollNew().catch(() => {});
    loadEndpoints().catch(() => {});
  }, [version, pollNew, loadEndpoints]);

  // Event detail
  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const res = await apiFetch<EventDetailDTO>(`/api/webhooks/${id}`);
      setDetail(res);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    loadDetail(selectedId).catch(() => setDetail(null));
  }, [selectedId, loadDetail]);

  const loadOlder = async () => {
    if (!endpointId || !cursor) return;
    const res = await apiFetch<{ events: EventSummaryDTO[]; nextCursor: string | null }>(
      `/api/webhooks/endpoints/${endpointId}/events?limit=40&cursor=${cursor}`,
    );
    setEvents((prev) => [...prev, ...res.events]);
    setCursor(res.nextCursor);
  };

  const onReplayed = (replay: ReplayDTO) => {
    setDetail((d) => (d ? { ...d, event: { ...d.event, replays: [replay, ...d.event.replays] } } : d));
    setEvents((prev) => prev.map((e) => (e.id === replay.eventId ? { ...e, replayCount: e.replayCount + 1 } : e)));
  };

  const endpoint = endpoints.find((e) => e.id === endpointId) ?? null;
  const ingestUrl = endpoint && origin ? `${origin}${endpoint.ingestPath}` : "";
  const ev = detail?.event;
  const query = (ev?.query ?? {}) as Record<string, string>;
  const headers = (ev?.headers ?? {}) as Record<string, string>;

  return (
    <div className={cn("panel grid min-h-[680px] grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]", className)}>
      {/* ── Left pane ──────────────────────────────────────────────────── */}
      <aside className="flex min-h-0 min-w-0 flex-col border-b border-hairline lg:border-b-0 lg:border-r">
        <div className="border-b border-hairline p-5">
          <div className="flex items-center justify-between">
            <p className="label">Capture endpoints</p>
            <button type="button" onClick={() => setCreating((c) => !c)} className="flex items-center gap-1 text-[12px] text-silver hover:text-ink" aria-expanded={creating}>
              <Plus size={13} strokeWidth={1.5} /> New
            </button>
          </div>
          <AnimatePresence>
            {creating && (
              <NewEndpointForm
                onCancel={() => setCreating(false)}
                onCreated={(ep) => {
                  setCreating(false);
                  const secret = (ep as SerializedEndpoint & { secret?: string }).secret;
                  if (secret) setRevealed({ id: ep.id, secret });
                  loadEndpoints().then(() => selectEndpoint(ep.id)).catch(() => {});
                }}
              />
            )}
          </AnimatePresence>
          <ul className="mt-3 flex flex-col gap-px" role="listbox" aria-label="Capture endpoints">
            {endpoints.map((e) => {
              const active = e.id === endpointId;
              return (
                <li key={e.id} role="option" aria-selected={active}>
                  <button
                    type="button"
                    onClick={() => selectEndpoint(e.id)}
                    className={cn(
                      "relative flex w-full items-center justify-between gap-3 py-2 pl-3 pr-2 text-left transition-colors duration-200",
                      active ? "bg-raised text-ink" : "text-body hover:bg-raised/50",
                    )}
                  >
                    {active && <motion.span layoutId="endpoint-rail" className="absolute inset-y-0 left-0 w-[2px] bg-copper" transition={transitionClassic(0.35)} />}
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium">{e.name}</span>
                      <span className="label">{e.signatureScheme === "NONE" ? "Unsigned" : `${SCHEME_NAME[e.signatureScheme]} HMAC`}</span>
                    </span>
                    <span className="num text-[12px] text-silver">{e.eventCount ?? 0}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {endpoint && (
          <div className="flex flex-col gap-4 border-b border-hairline p-5">
            {revealed?.id === endpoint.id && (
              <div className="border border-hairline-strong bg-raised p-3">
                <p className="text-[12px] text-ink">Signing secret — shown once. Store it in your provider settings.</p>
                <CopyField value={revealed.secret} className="mt-2" />
              </div>
            )}
            <CopyField label="Ingest URL · POST / PUT / PATCH" value={ingestUrl} display={ingestUrl || endpoint.ingestPath} />
            <CopyField
              label="Test with curl"
              value={`curl -X POST ${ingestUrl} -H 'content-type: application/json' -d '{"type":"vigil.test","hello":"world"}'`}
              display={`curl -X POST …${endpoint.token.slice(-6)} -d '{…}'`}
            />
            <RateMeter meter={meter?.rateLimit ?? null} />
          </div>
        )}

        <div className="flex items-center justify-between px-5 pb-2 pt-4">
          <p className="label flex items-center gap-2.5">
            <HeartbeatRipple beat={streamBeat} tone={live ? "copper" : "idle"} size={6} />
            Live stream
          </p>
          <span className="num text-[12px] text-silver/70">{live ? `polling ${STREAM_POLL_MS / 1000}s` : "paused"}</span>
        </div>
        <div className="min-h-[260px] flex-1 overflow-y-auto lg:min-h-0">
          {events.length === 0 && (
            <div className="px-5 py-10 text-center">
              <Webhook size={20} strokeWidth={1.5} className="mx-auto text-silver/50" />
              <p className="mt-3 text-[13px] text-silver">No requests captured yet</p>
              <p className="mt-1 text-[12px] text-silver/70">Send one with curl, or fire a sample from the simulator</p>
            </div>
          )}
          <motion.ul layout className="flex flex-col">
            <AnimatePresence initial={false}>
              {events.map((e) => {
                const active = e.id === selectedId;
                const sigRgb = TONE_RGB[toneForStatus(e.signatureStatus)];
                return (
                  <motion.li
                    key={e.id}
                    layout="position"
                    variants={feedItem}
                    initial={fresh.has(e.id) ? "initial" : false}
                    animate="animate"
                    exit="exit"
                    className="border-b border-b-hairline"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(e.id);
                        setTab("payload");
                      }}
                      className={cn(
                        "relative block w-full px-4 py-3 text-left transition-colors duration-150",
                        active ? "bg-surface font-medium border-l-[3px] border-l-vermilion shadow-sm" : "hover:bg-well/40 text-body",
                      )}
                      aria-current={active}
                    >
                      <span className="flex items-center justify-between gap-3">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="num rounded-[1px] border border-hairline bg-well px-1.5 py-0.2 font-mono text-[10px] text-silver">{e.method}</span>
                          <span className={cn("truncate text-[13px]", active ? "text-ink" : "text-body")}>{e.eventType ?? "unknown event"}</span>
                        </span>
                        <span className="dot" style={{ backgroundColor: `rgb(${sigRgb})` }} title={e.signatureStatus} />
                      </span>
                      <span className="num mt-1 flex justify-between font-mono text-[11px] text-silver">
                        <span>{formatRelative(e.receivedAt, now)}</span>
                        <span>
                          {formatBytes(e.sizeBytes)}
                          {e.replayCount > 0 && <span> · {e.replayCount} replayed</span>}
                        </span>
                      </span>
                    </button>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </motion.ul>
          {cursor && (
            <button type="button" onClick={loadOlder} className="label w-full py-3 hover:text-ink">
              Load older
            </button>
          )}
        </div>
      </aside>

      {/* ── Right pane ─────────────────────────────────────────────────── */}
      <section className="flex min-h-0 min-w-0 flex-col">
        {!ev ? (
          <div className="grid flex-1 place-items-center p-10 text-center">
            <div>
              <p className="text-[15px] text-body">{detailLoading ? "Loading…" : "Select a captured request"}</p>
              <p className="mt-2 text-[13px] text-silver/70">Payload, headers, HMAC verdict and replay history appear here</p>
            </div>
          </div>
        ) : (
          <>
            <header className="border-b border-hairline p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="label">Captured request</p>
                  <h3 className="mt-2 truncate text-[28px] leading-tight">{ev.eventType ?? "Unknown event"}</h3>
                </div>
                <div className="flex items-center gap-2.5">
                  <button type="button" className="btn-ghost h-9 w-9 !px-0" onClick={() => loadDetail(ev.id)} aria-label="Refresh">
                    <RotateCcw size={14} strokeWidth={1.5} />
                  </button>
                  <button type="button" className="btn-primary" onClick={() => setReplayOpen(true)}>
                    Edit &amp; replay
                  </button>
                </div>
              </div>
              <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                {[
                  ["Received", formatDateTime(ev.receivedAt)],
                  ["Method", ev.method],
                  ["Source IP", ev.sourceIp ?? "—"],
                  ["Content type", ev.contentType ?? "—"],
                  ["Size", formatBytes(ev.sizeBytes)],
                  ["Replays", String(ev.replays.length)],
                ].map(([k, v]) => (
                  <div key={k} className="min-w-0">
                    <dt className="label">{k}</dt>
                    <dd className="num mt-1 truncate text-[13px] text-ink" title={v}>
                      {v}
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-hairline pt-4">
                <StatusBadge status={ev.signatureStatus} />
                <p className="text-[12px] text-silver">
                  {SIGNATURE_COPY[ev.signatureStatus]}
                  {detail?.endpoint.signatureScheme !== "NONE" && <span className="text-silver/70"> · {SCHEME_NAME[detail!.endpoint.signatureScheme]} scheme</span>}
                </p>
              </div>
            </header>

            {/* Instant Solutions & Guided Remediation */}
            {(ev.signatureStatus === "INVALID" || ev.signatureStatus === "MISSING") && (
              <div className="px-5 pt-3 pb-2 sm:px-6">
                <InstantSolutionsPanel
                  webhookId={ev.id}
                  webhookContext={{
                    eventId: ev.id,
                    onSmartReplayDone: () => {
                      loadDetail(ev.id);
                    },
                  }}
                  onRemediated={() => {
                    loadDetail(ev.id);
                  }}
                />
              </div>
            )}

            <SegmentedTabs<DetailTab>
              ariaLabel="Request detail"
              className="px-3 sm:px-4"
              value={tab}
              onChange={setTab}
              items={[
                { value: "payload", label: "Payload" },
                { value: "headers", label: "Headers", count: Object.keys(headers).length },
                { value: "replays", label: "Replays", count: ev.replays.length },
              ]}
            />

            <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={`${ev.id}-${tab}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0, transition: transitionClassic(0.3) }} exit={{ opacity: 0, transition: { duration: 0.12 } }}>
                  {tab === "payload" && (
                    <div className="flex flex-col gap-4">
                      {Object.keys(query).length > 0 && (
                        <div>
                          <p className="label mb-2">Query parameters</p>
                          <div className="well divide-y divide-hairline">
                            {Object.entries(query).map(([k, v]) => (
                              <div key={k} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-4 px-3 py-1.5">
                                <span className="text-silver">{k}</span>
                                <span className="break-all text-ink">{v}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      <div>
                        <p className="label mb-2">{ev.jsonBody != null ? "JSON body" : "Raw body"}</p>
                        <JsonView value={ev.jsonBody ?? ev.rawBody} maxHeight={560} />
                      </div>
                    </div>
                  )}

                  {tab === "headers" && (
                    <div className="well divide-y divide-hairline">
                      {Object.entries(headers).map(([k, v]) => {
                        const isSig = /signature/i.test(k);
                        return (
                          <div key={k} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4 px-3.5 py-2">
                            <span className={cn("truncate", isSig ? "text-ink" : "text-silver")} title={k}>
                              {k}
                            </span>
                            <span className="break-all text-ink">{v}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {tab === "replays" && (
                    <div className="flex flex-col gap-2">
                      {ev.replays.length === 0 && (
                        <div className="py-10 text-center">
                          <p className="text-[13px] text-silver">No replays yet</p>
                          <button type="button" className="btn-ghost mt-4" onClick={() => setReplayOpen(true)}>
                            Open replay engine
                          </button>
                        </div>
                      )}
                      {ev.replays.map((r) => {
                        const open = expandedReplay === r.id;
                        const code = r.responseStatus;
                        const tone = code == null ? "text-crit" : code < 300 ? "text-ok" : code < 500 ? "text-warn" : "text-crit";
                        return (
                          <div key={r.id} className="border border-hairline">
                            <button type="button" onClick={() => setExpandedReplay(open ? null : r.id)} className="grid w-full grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-3 px-3.5 py-2.5 text-left hover:bg-raised/50" aria-expanded={open}>
                              <span className={cn("num text-[15px] font-medium", tone)}>{code ?? "ERR"}</span>
                              <span className="min-w-0">
                                <span className="num block truncate text-[12px] text-ink">
                                  {r.method} {r.targetUrl}
                                </span>
                                {r.error && <span className="block truncate text-[12px] text-[#E88A80]">{r.error}</span>}
                              </span>
                              <span className="num text-right text-[12px] text-silver">
                                {formatMs(r.latencyMs)}
                                <br />
                                {formatRelative(r.createdAt, now)}
                              </span>
                            </button>
                            <AnimatePresence initial={false}>
                              {open && (
                                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={transitionClassic(0.3)} className="overflow-hidden">
                                  <div className="border-t border-hairline p-3">
                                    {r.responseBody != null ? <JsonView value={r.responseBody} maxHeight={240} /> : <p className="text-[12px] text-silver">No response body</p>}
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </>
        )}
      </section>

      <ReplayPanel open={replayOpen} onClose={() => setReplayOpen(false)} detail={detail} onReplayed={onReplayed} />
    </div>
  );
}
