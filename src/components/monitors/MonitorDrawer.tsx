"use client";

import { Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Drawer } from "@/components/ui/Drawer";
import { Field, FormError, Toggle } from "@/components/ui/Field";
import { useTelemetry } from "@/components/providers/TelemetryProvider";
import { apiFetch, ApiClientError, errorMessage } from "@/lib/client/api";
import type { MonitorSummary, ProbeResult } from "@/lib/client/types";
import { SIM_SERVICES } from "@/lib/sim";
import { HTTP_METHODS, monitorCreateSchema, monitorUpdateSchema } from "@/lib/validation";

interface FormState {
  name: string;
  url: string;
  method: (typeof HTTP_METHODS)[number];
  expectedStatus: string;
  timeoutMs: string;
  intervalSec: string;
  degradedThresholdMs: string;
  bodyContains: string;
  showOnStatusPage: boolean;
  isPaused: boolean;
}

const BLANK: FormState = {
  name: "",
  url: "",
  method: "GET",
  expectedStatus: "200",
  timeoutMs: "10000",
  intervalSec: "60",
  degradedThresholdMs: "500",
  bodyContains: "",
  showOnStatusPage: false,
  isPaused: false,
};

function fromMonitor(m: MonitorSummary): FormState {
  return {
    name: m.name,
    url: m.url,
    method: m.method,
    expectedStatus: String(m.expectedStatus),
    timeoutMs: String(m.timeoutMs),
    intervalSec: String(m.intervalSec),
    degradedThresholdMs: String(m.degradedThresholdMs),
    bodyContains: m.bodyContains ?? "",
    showOnStatusPage: m.showOnStatusPage,
    isPaused: m.isPaused,
  };
}

interface MonitorDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Present → edit mode. */
  monitor?: MonitorSummary | null;
  onSaved?: (monitor: MonitorSummary) => void;
  onDeleted?: (id: string) => void;
}

/**
 * Create / edit monitor slide-over. Validates client-side with the same Zod
 * schema the API enforces, then surfaces server-side failures (SSRF
 * rejections, limits) verbatim.
 */
export function MonitorDrawer({ open, onClose, monitor, onSaved, onDeleted }: MonitorDrawerProps) {
  const editing = Boolean(monitor);
  const { registerResults, bump } = useTelemetry();
  const [form, setForm] = useState<FormState>(BLANK);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(monitor ? fromMonitor(monitor) : BLANK);
    setErrors({});
    setServerError(null);
    setConfirmDelete(false);
  }, [open, monitor]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => {
      if (!e[key]) return e;
      const { [key]: _removed, ...rest } = e;
      return rest;
    });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setServerError(null);
    const payload = {
      name: form.name,
      url: form.url,
      method: form.method,
      expectedStatus: form.expectedStatus,
      timeoutMs: form.timeoutMs,
      intervalSec: form.intervalSec,
      degradedThresholdMs: form.degradedThresholdMs,
      bodyContains: form.bodyContains || null,
      showOnStatusPage: form.showOnStatusPage,
      isPaused: form.isPaused,
    };
    const parsed = (editing ? monitorUpdateSchema : monitorCreateSchema).safeParse(payload);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) fieldErrors[issue.path.join(".")] ??= issue.message;
      setErrors(fieldErrors);
      return;
    }

    setSaving(true);
    try {
      if (editing && monitor) {
        const res = await apiFetch<{ monitor: MonitorSummary }>(`/api/monitors/${monitor.id}`, { method: "PATCH", json: parsed.data });
        onSaved?.(res.monitor);
      } else {
        const res = await apiFetch<{ monitor: MonitorSummary; firstProbe: ProbeResult | null }>("/api/monitors", {
          method: "POST",
          json: parsed.data,
        });
        if (res.firstProbe) registerResults([res.firstProbe]);
        onSaved?.(res.monitor);
      }
      bump();
      onClose();
    } catch (err) {
      if (err instanceof ApiClientError && Object.keys(err.fieldErrors).length) setErrors(err.fieldErrors);
      setServerError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!monitor) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setSaving(true);
    try {
      await apiFetch(`/api/monitors/${monitor.id}`, { method: "DELETE" });
      onDeleted?.(monitor.id);
      bump();
      onClose();
    } catch (err) {
      setServerError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow={editing ? "Edit monitor" : "New monitor"}
      title={editing ? monitor!.name : "Watch an endpoint"}
      description={
        editing
          ? "Changing the target, method or assertions resets the failure streak."
          : "Vigil probes the URL server-side on an interval, records latency and opens an incident after 3 consecutive failures."
      }
      footer={
        <div className="flex items-center justify-between gap-3">
          {editing ? (
            <button type="button" onClick={remove} disabled={saving} className="btn-ghost text-crit hover:text-crit">
              <Trash2 size={14} strokeWidth={1.5} />
              {confirmDelete ? "Confirm delete" : "Delete"}
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2.5">
            <button type="button" onClick={onClose} className="btn-ghost">
              Cancel
            </button>
            <button type="submit" form="monitor-form" disabled={saving} className="btn-primary min-w-[128px]">
              {saving ? "Saving…" : editing ? "Save changes" : "Create & probe"}
            </button>
          </div>
        </div>
      }
    >
      <form id="monitor-form" onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <FormError message={serverError} />

        <Field label="Name" error={errors.name}>
          {(p) => <input {...p} data-autofocus className="input font-sans" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Checkout API" maxLength={80} />}
        </Field>

        <div className="grid grid-cols-[110px_1fr] gap-3">
          <Field label="Method" error={errors.method}>
            {(p) => (
              <select {...p} className="select" value={form.method} onChange={(e) => set("method", e.target.value as FormState["method"])}>
                {HTTP_METHODS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            )}
          </Field>
          <Field label="URL" error={errors.url} hint="Public http(s) only — private, loopback and metadata addresses are refused">
            {(p) => <input {...p} className="input" value={form.url} onChange={(e) => set("url", e.target.value)} placeholder="https://api.example.com/health" inputMode="url" spellCheck={false} />}
          </Field>
        </div>

        <div className="-mt-2 flex flex-wrap items-center gap-1.5">
          <span className="label mr-1">Demo targets</span>
          {SIM_SERVICES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                set("url", `/api/sim/${s.id}`);
                if (!form.name) set("name", s.label);
                if (!form.bodyContains) set("bodyContains", '"status":"ok"');
              }}
              className="num rounded-sm border border-hairline px-2 py-1 text-[12px] text-silver transition-colors hover:border-hairline-strong hover:text-ink"
            >
              /api/sim/{s.id}
            </button>
          ))}
        </div>

        <div className="h-px bg-rule" />
        <p className="label -mb-1">Assertions</p>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Expected status" error={errors.expectedStatus}>
            {(p) => <input {...p} className="input" value={form.expectedStatus} onChange={(e) => set("expectedStatus", e.target.value)} inputMode="numeric" />}
          </Field>
          <Field label="Degraded above (ms)" error={errors.degradedThresholdMs}>
            {(p) => <input {...p} className="input" value={form.degradedThresholdMs} onChange={(e) => set("degradedThresholdMs", e.target.value)} inputMode="numeric" />}
          </Field>
        </div>

        <Field label="Body contains (optional)" error={errors.bodyContains} hint="Substring that must appear in the response body">
          {(p) => <input {...p} className="input" value={form.bodyContains} onChange={(e) => set("bodyContains", e.target.value)} placeholder='"status":"ok"' spellCheck={false} />}
        </Field>

        <div className="h-px bg-rule" />
        <p className="label -mb-1">Schedule</p>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Interval (s)" error={errors.intervalSec} hint="30s – 24h">
            {(p) => <input {...p} className="input" value={form.intervalSec} onChange={(e) => set("intervalSec", e.target.value)} inputMode="numeric" />}
          </Field>
          <Field label="Timeout (ms)" error={errors.timeoutMs} hint="500 – 30,000">
            {(p) => <input {...p} className="input" value={form.timeoutMs} onChange={(e) => set("timeoutMs", e.target.value)} inputMode="numeric" />}
          </Field>
        </div>

        <div className="h-px bg-rule" />
        <div className="flex flex-col gap-4">
          <Toggle
            checked={form.showOnStatusPage}
            onChange={(v) => set("showOnStatusPage", v)}
            label="Show on public status page"
            description="Listed as a component with 30-day uptime bars"
          />
          <Toggle
            checked={form.isPaused}
            onChange={(v) => set("isPaused", v)}
            label="Paused"
            description="Skipped by cron and live sweeps; manual probes still work"
          />
        </div>
      </form>
    </Drawer>
  );
}
