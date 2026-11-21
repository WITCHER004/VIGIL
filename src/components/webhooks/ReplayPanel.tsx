"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CornerDownLeft, Plus, Send, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Drawer } from "@/components/ui/Drawer";
import { Field, FormError, Toggle } from "@/components/ui/Field";
import { JsonView } from "@/components/ui/JsonView";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { apiFetch, ApiClientError, errorMessage } from "@/lib/client/api";
import type { EventDetailDTO, ReplayDTO } from "@/lib/client/types";
import { transitionClassic } from "@/lib/motion";
import { cn, formatMs } from "@/lib/utils";
import { REPLAY_METHODS } from "@/lib/validation";

const TARGET_KEY = "vigil:replay-target";
const DEFAULT_TARGET = "/api/sim/checkout-api";

interface HeaderRow {
  id: number;
  key: string;
  value: string;
}

function statusTone(code: number | null | undefined): string {
  if (code == null) return "text-crit";
  if (code < 300) return "text-ok";
  if (code < 500) return "text-warn";
  return "text-crit";
}

interface ReplayPanelProps {
  open: boolean;
  onClose: () => void;
  detail: EventDetailDTO | null;
  onReplayed?: (replay: ReplayDTO) => void;
}

/**
 * Edit & Replay drawer. Forwards the captured payload (verbatim or edited) to
 * any public URL through the server's SSRF-pinned client, optionally re-signing
 * it with the endpoint secret, and shows the live response.
 */
export function ReplayPanel({ open, onClose, detail, onReplayed }: ReplayPanelProps) {
  const [target, setTarget] = useState(DEFAULT_TARGET);
  const [method, setMethod] = useState<(typeof REPLAY_METHODS)[number]>("POST");
  const [body, setBody] = useState("");
  const [rows, setRows] = useState<HeaderRow[]>([]);
  const [resign, setResign] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<ReplayDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  const original = detail?.event.rawBody ?? "";
  const canSign = Boolean(detail?.endpoint.hasSecret && detail.endpoint.signatureScheme !== "NONE");
  const edited = body !== original;

  useEffect(() => {
    if (!open || !detail) return;
    try {
      setTarget(window.localStorage.getItem(TARGET_KEY) || DEFAULT_TARGET);
    } catch {
      setTarget(DEFAULT_TARGET);
    }
    const m = detail.replayDefaults.method;
    setMethod((REPLAY_METHODS as readonly string[]).includes(m) ? (m as (typeof REPLAY_METHODS)[number]) : "POST");
    setBody(detail.event.rawBody);
    setRows(Object.entries(detail.replayDefaults.headers).map(([key, value], i) => ({ id: i, key, value })));
    setResign(false);
    setResult(null);
    setError(null);
  }, [open, detail]);

  // Editing a signed payload invalidates its signature — default to re-signing.
  useEffect(() => {
    if (edited && canSign) setResign(true);
  }, [edited, canSign]);

  const bodyIsJson = useMemo(() => {
    try {
      JSON.parse(body);
      return true;
    } catch {
      return false;
    }
  }, [body]);

  const overrides = useMemo(() => {
    const out: Record<string, string> = {};
    const defaults = detail?.replayDefaults.headers ?? {};
    const current = new Map(rows.filter((r) => r.key.trim()).map((r) => [r.key.trim().toLowerCase(), r.value]));
    for (const k of Object.keys(defaults)) if (!current.has(k)) out[k] = "";
    for (const [k, v] of current) if (defaults[k] !== v) out[k] = v;
    return out;
  }, [rows, detail]);

  const send = async () => {
    if (!detail || sending) return;
    setSending(true);
    setError(null);
    try {
      window.localStorage.setItem(TARGET_KEY, target);
    } catch {
      /* ignore */
    }
    try {
      const res = await apiFetch<{ replay: ReplayDTO }>(`/api/webhooks/${detail.event.id}/replay`, {
        method: "POST",
        json: { targetUrl: target.trim(), method, body: edited ? body : undefined, headers: overrides, resign: resign && canSign },
      });
      setResult(res.replay);
      onReplayed?.(res.replay);
    } catch (err) {
      const replay = err instanceof ApiClientError ? (err.body as { replay?: ReplayDTO } | null)?.replay : undefined;
      if (replay) {
        setResult(replay);
        onReplayed?.(replay);
      }
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void send();
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="lg"
      eyebrow="Replay engine"
      title="Replay request"
      description={detail ? `${detail.event.eventType ?? "Webhook"} · captured on ${detail.endpoint.name}` : undefined}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="hidden items-center gap-1.5 text-[12px] text-silver sm:flex">
            <kbd className="num rounded-sm border border-hairline px-1.5 py-0.5 text-[12px]">Ctrl</kbd>
            <CornerDownLeft size={12} strokeWidth={1.5} /> to send
          </span>
          <button type="button" onClick={send} disabled={sending || !target.trim()} className="btn-primary min-w-[148px]">
            <Send size={14} strokeWidth={1.5} />
            {sending ? "Forwarding…" : "Send replay"}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-5" onKeyDown={onKeyDown}>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <Field label="Target URL" hint="Any public URL, or Vigil's own /api/sim/* demo endpoints">
            {(p) => <input {...p} data-autofocus className="input" value={target} onChange={(e) => setTarget(e.target.value)} spellCheck={false} />}
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="label">Method</span>
            <SegmentedTabs ariaLabel="Replay method" size="sm" mono items={REPLAY_METHODS.map((m) => ({ value: m, label: m }))} value={method} onChange={setMethod} className="h-9 border-0" />
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="label">
              Body {edited && <span className="ml-1.5 text-copper">· edited</span>}
            </span>
            <div className="flex gap-3 text-[12px]">
              {bodyIsJson && (
                <button type="button" className="text-silver hover:text-ink" onClick={() => setBody(JSON.stringify(JSON.parse(body), null, 2))}>
                  Format
                </button>
              )}
              {edited && (
                <button type="button" className="text-silver hover:text-ink" onClick={() => setBody(original)}>
                  Restore original bytes
                </button>
              )}
            </div>
          </div>
          <textarea
            className={cn("textarea min-h-[200px] text-[12px]", !bodyIsJson && body.trim() && "border-warn/50")}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            spellCheck={false}
            aria-label="Replay body"
          />
          {!bodyIsJson && body.trim() && <p className="mt-1.5 text-[12px] text-warn">Body is not valid JSON — it will be sent as-is</p>}
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="label">Headers</span>
            <button
              type="button"
              className="flex items-center gap-1 text-[12px] text-silver hover:text-ink"
              onClick={() => setRows((r) => [...r, { id: Date.now(), key: "", value: "" }])}
            >
              <Plus size={12} strokeWidth={1.5} /> Add header
            </button>
          </div>
          <div className="well divide-y divide-hairline">
            {rows.length === 0 && <p className="px-3 py-2.5 text-silver/70">No forwarded headers</p>}
            {rows.map((row) => (
              <div key={row.id} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_28px] items-center gap-2 px-2 py-1">
                <input
                  className="h-7 bg-transparent px-1 text-[12px] text-silver focus:text-ink focus:outline-none"
                  value={row.key}
                  onChange={(e) => setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, key: e.target.value } : r)))}
                  placeholder="header-name"
                  aria-label="Header name"
                  spellCheck={false}
                />
                <input
                  className="h-7 bg-transparent px-1 text-[12px] text-ink focus:outline-none"
                  value={row.value}
                  onChange={(e) => setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, value: e.target.value } : r)))}
                  placeholder="value"
                  aria-label="Header value"
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="grid h-6 w-6 place-items-center text-silver/60 hover:text-crit"
                  onClick={() => setRows((rs) => rs.filter((r) => r.id !== row.id))}
                  aria-label={`Remove ${row.key || "header"}`}
                >
                  <X size={12} strokeWidth={1.5} />
                </button>
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-[12px] text-silver/80">Host, Content-Length, credentials and proxy headers are never forwarded</p>
        </div>

        <Toggle
          checked={resign && canSign}
          onChange={setResign}
          label="Re-sign with endpoint secret"
          description={
            canSign
              ? `Replaces the ${({ STRIPE: "Stripe", GITHUB: "GitHub", RAZORPAY: "Razorpay", GENERIC: "generic" } as Record<string, string>)[detail?.endpoint.signatureScheme ?? ""] ?? ""} signature so the target can verify the ${edited ? "edited" : "replayed"} body.`
              : "This endpoint has no signing secret configured."
          }
        />

        <FormError message={error} />

        <AnimatePresence mode="wait">
          {result && (
            <motion.section
              key={result.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0, transition: transitionClassic(0.45) }}
              exit={{ opacity: 0 }}
              className="panel p-4"
              aria-live="polite"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div className="flex items-baseline gap-3">
                  <span className={cn("num text-[32px] font-medium leading-none", statusTone(result.responseStatus))}>{result.responseStatus ?? "ERR"}</span>
                  <span className="label">Response</span>
                </div>
                <span className="num text-[13px] text-ink">{formatMs(result.latencyMs)}</span>
              </div>
              <p className="num mt-2 truncate text-[12px] text-silver" title={result.targetUrl}>
                {result.method} {result.targetUrl}
              </p>
              {result.error && <p className="mt-2 text-[12px] text-[#E88A80]">{result.error}</p>}
              {result.responseBody != null && (
                <div className="mt-3">
                  <JsonView value={result.responseBody} maxHeight={260} />
                </div>
              )}
              {result.responseHeaders && (
                <details className="mt-3 text-[12px]">
                  <summary className="label cursor-pointer select-none hover:text-ink">Response headers</summary>
                  <dl className="num mt-2 space-y-1">
                    {Object.entries(result.responseHeaders as Record<string, string>).map(([k, v]) => (
                      <div key={k} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3">
                        <dt className="truncate text-silver">{k}</dt>
                        <dd className="break-all text-body">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              )}
            </motion.section>
          )}
        </AnimatePresence>
      </div>
    </Drawer>
  );
}
