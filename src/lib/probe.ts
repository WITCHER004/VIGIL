import "server-only";
import { MonitorStatus, type Monitor } from "@prisma/client";
import { performance } from "node:perf_hooks";
import { db } from "./db";
import { applyCheckToIncidents } from "./incidents";
import { safeFetch, SsrfError } from "./ssrf";
import { deriveStatus, type IncidentAction } from "./stats";

/**
 * Synthetic probe engine.
 *
 * 1. Network: SSRF-pinned request, round-trip timed with `performance.now()`
 *    from dispatch until the (capped) body is fully read.
 * 2. Assertions: expected status code + optional body substring.
 * 3. Persistence: CheckRun insert, incident state machine and monitor rollup
 *    in one transaction guarded by a per-monitor Postgres advisory lock.
 */

export type ProbeSource = "cron" | "live" | "manual" | "sweep";

const MAX_BODY_BYTES = 256 * 1024;
const USER_AGENT = "Vigil/1.0 (+synthetic uptime probe)";

export interface RawProbe {
  ok: boolean;
  statusCode: number | null;
  latencyMs: number;
  statusOk: boolean;
  bodyOk: boolean | null;
  error: string | null;
}

export interface ProbeResult extends RawProbe {
  monitorId: string;
  name: string;
  status: MonitorStatus;
  checkedAt: string;
  checkId: string;
  incident: { action: IncidentAction; id: string | null };
}

/** Read a response body as UTF-8, truncating after `max` bytes. */
/** Structural stream type — satisfied by both DOM and undici ReadableStreams. */
interface ByteStream {
  getReader(): {
    read(): Promise<{ done: boolean; value?: Uint8Array }>;
    cancel(reason?: unknown): Promise<void>;
  };
}

export async function readBodyCapped(body: ByteStream | null, max = MAX_BODY_BYTES): Promise<string> {
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    const room = max - total;
    if (value.byteLength >= room) {
      chunks.push(value.subarray(0, room));
      total += room;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(merged);
}

/** Turn undici / abort / SSRF failures into a short operator-readable message. */
export function describeFetchError(err: unknown, timeoutMs: number): string {
  if (err instanceof SsrfError) return `Blocked by SSRF guard: ${err.message}`;
  const e = err as { name?: string; message?: string; cause?: { code?: string; name?: string; message?: string } };
  if (e?.name === "TimeoutError" || e?.cause?.name === "TimeoutError" || e?.name === "AbortError") {
    return `Request timed out after ${timeoutMs}ms`;
  }
  if (e?.cause instanceof SsrfError) return `Blocked by SSRF guard: ${e.cause.message}`;
  const code = e?.cause?.code;
  switch (code) {
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "DNS lookup failed";
    case "ECONNREFUSED":
      return "Connection refused";
    case "ECONNRESET":
      return "Connection reset by peer";
    case "UND_ERR_CONNECT_TIMEOUT":
      return "Connection timed out";
    case "CERT_HAS_EXPIRED":
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "ERR_TLS_CERT_ALTNAME_INVALID":
      return `TLS error (${code})`;
  }
  return (e?.cause?.message ?? e?.message ?? "Request failed").slice(0, 300);
}

/** Perform the HTTP request and evaluate assertions. Never throws. */
export async function executeProbe(
  monitor: Pick<Monitor, "url" | "method" | "expectedStatus" | "timeoutMs" | "bodyContains">,
  appOrigin: string,
): Promise<RawProbe> {
  const started = performance.now();
  try {
    const { response } = await safeFetch(monitor.url, appOrigin, {
      method: monitor.method,
      timeoutMs: monitor.timeoutMs,
      headers: { "user-agent": USER_AGENT, accept: "*/*", "cache-control": "no-cache" },
    });
    const text = monitor.method === "HEAD" ? "" : await readBodyCapped(response.body);
    const latencyMs = Math.max(1, Math.round(performance.now() - started));

    const statusOk = response.status === monitor.expectedStatus;
    const bodyOk = monitor.bodyContains ? text.includes(monitor.bodyContains) : null;
    const ok = statusOk && bodyOk !== false;

    let error: string | null = null;
    if (!statusOk) error = `Expected HTTP ${monitor.expectedStatus}, received ${response.status}`;
    else if (bodyOk === false) error = `Response body does not contain "${monitor.bodyContains!.slice(0, 80)}"`;

    return { ok, statusCode: response.status, latencyMs, statusOk, bodyOk, error };
  } catch (err) {
    const latencyMs = Math.max(1, Math.round(performance.now() - started));
    return {
      ok: false,
      statusCode: null,
      latencyMs: Math.min(latencyMs, monitor.timeoutMs + 250),
      statusOk: false,
      bodyOk: monitor.bodyContains ? false : null,
      error: describeFetchError(err, monitor.timeoutMs),
    };
  }
}

/** Probe one monitor end-to-end and persist the outcome. */
export async function probeMonitor(monitor: Monitor, source: ProbeSource, appOrigin: string): Promise<ProbeResult> {
  const raw = await executeProbe(monitor, appOrigin);
  const checkedAt = new Date();

  return db.$transaction(
    async (tx) => {
      // Serialise all state-machine work for this monitor across instances.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${monitor.id}))`;

      const fresh = await tx.monitor.findUnique({ where: { id: monitor.id } });
      if (!fresh) throw new Error(`Monitor ${monitor.id} was deleted mid-probe`);

      const check = await tx.checkRun.create({
        data: { monitorId: fresh.id, ...raw, source, checkedAt },
        select: { id: true },
      });

      // Paused monitors still record manual checks but never drive incidents.
      const transition = fresh.isPaused
        ? {
            action: "none" as const,
            incidentId: null,
            consecutiveFailures: fresh.consecutiveFailures,
            consecutiveSuccesses: fresh.consecutiveSuccesses,
            hasOpenIncident: false,
          }
        : await applyCheckToIncidents(tx, fresh, { ...raw, checkedAt });

      const status = deriveStatus({
        ok: raw.ok,
        latencyMs: raw.latencyMs,
        degradedThresholdMs: fresh.degradedThresholdMs,
        consecutiveFailures: transition.consecutiveFailures,
        hasOpenIncident: transition.hasOpenIncident,
        isPaused: fresh.isPaused,
      }) as MonitorStatus;

      await tx.monitor.update({
        where: { id: fresh.id },
        data: {
          status,
          consecutiveFailures: transition.consecutiveFailures,
          consecutiveSuccesses: transition.consecutiveSuccesses,
          lastCheckedAt: checkedAt,
          lastLatencyMs: raw.latencyMs,
          lastStatusCode: raw.statusCode,
        },
      });

      return {
        ...raw,
        monitorId: fresh.id,
        name: fresh.name,
        status,
        checkedAt: checkedAt.toISOString(),
        checkId: check.id,
        incident: { action: transition.action, id: transition.incidentId },
      };
    },
    { maxWait: 5_000, timeout: 15_000 },
  );
}

/**
 * Atomically lease every active monitor whose interval has elapsed.
 * Bumping `lastCheckedAt` in the same statement means concurrent pollers
 * (several open dashboards + cron) never probe the same monitor twice.
 */
export async function claimDueMonitors(limit = 25): Promise<Monitor[]> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    UPDATE "Monitor" SET "lastCheckedAt" = (NOW() AT TIME ZONE 'UTC')
    WHERE id IN (
      SELECT id FROM "Monitor"
      WHERE "isPaused" = false
        AND ("lastCheckedAt" IS NULL
             OR "lastCheckedAt" <= (NOW() AT TIME ZONE 'UTC') - make_interval(secs => "intervalSec"))
      ORDER BY "lastCheckedAt" ASC NULLS FIRST
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id`;
  if (rows.length === 0) return [];
  return db.monitor.findMany({ where: { id: { in: rows.map((r) => r.id) } } });
}

/** Probe many monitors with bounded concurrency. Individual failures never abort the sweep. */
export async function runSweep(
  monitors: Monitor[],
  source: ProbeSource,
  appOrigin: string,
  concurrency = 6,
): Promise<{ results: ProbeResult[]; errors: { monitorId: string; error: string }[] }> {
  const results: ProbeResult[] = [];
  const errors: { monitorId: string; error: string }[] = [];
  let cursor = 0;

  async function worker() {
    while (cursor < monitors.length) {
      const m = monitors[cursor++]!;
      try {
        results.push(await probeMonitor(m, source, appOrigin));
      } catch (err) {
        console.error(`[probe] ${m.name} failed to persist:`, err);
        errors.push({ monitorId: m.id, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, monitors.length) }, worker));
  results.sort((a, b) => a.name.localeCompare(b.name));
  return { results, errors };
}
