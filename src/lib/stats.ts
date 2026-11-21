/**
 * Telemetry maths. Pure functions only — safe on server and client.
 * Prisma enum values are mirrored as string unions so this module never
 * pulls the Prisma client into a browser bundle.
 */

export type MonitorState = "PENDING" | "OPERATIONAL" | "DEGRADED" | "DOWN" | "PAUSED";

export interface CheckSample {
  ok: boolean;
  latencyMs: number;
  statusCode?: number | null;
  checkedAt: Date | string | number;
}

export interface LatencySummary {
  p50: number | null;
  p95: number | null;
  p99: number | null;
  mean: number | null;
  min: number | null;
  max: number | null;
  count: number;
}

// ─── Percentiles ──────────────────────────────────────────────────────────────

/**
 * Percentile with linear interpolation between closest ranks (the "R-7" / Excel
 * PERCENTILE.INC method). `sorted` must be ascending. `p` in [0, 100].
 */
export function percentile(sorted: readonly number[], p: number): number | null {
  const n = sorted.length;
  if (n === 0) return null;
  if (n === 1) return sorted[0]!;
  const rank = (Math.min(100, Math.max(0, p)) / 100) * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const a = sorted[lo]!;
  const b = sorted[hi]!;
  return a + (b - a) * (rank - lo);
}

/**
 * Only checks that actually received an HTTP response contribute to latency —
 * a 10s timeout is an availability failure, not a latency datapoint.
 */
function respondedLatencies(samples: readonly CheckSample[]): number[] {
  const out: number[] = [];
  for (const s of samples) {
    if (s.ok || s.statusCode != null) out.push(s.latencyMs);
  }
  return out.sort((a, b) => a - b);
}

export function latencySummary(samples: readonly CheckSample[]): LatencySummary {
  const sorted = respondedLatencies(samples);
  const count = sorted.length;
  if (count === 0) return { p50: null, p95: null, p99: null, mean: null, min: null, max: null, count: 0 };
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    p50: round(percentile(sorted, 50)),
    p95: round(percentile(sorted, 95)),
    p99: round(percentile(sorted, 99)),
    mean: round(sum / count),
    min: sorted[0]!,
    max: sorted[count - 1]!,
    count,
  };
}

/** Uptime % over the samples, or null when there is no data. */
export function uptimePercent(samples: readonly Pick<CheckSample, "ok">[]): number | null {
  if (samples.length === 0) return null;
  let up = 0;
  for (const s of samples) if (s.ok) up++;
  return (up / samples.length) * 100;
}

/** Median of a list of nullable numbers (used for "Median p95" across monitors). */
export function median(values: readonly (number | null | undefined)[]): number | null {
  const clean = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
  return round(percentile(clean, 50));
}

function round(v: number | null): number | null {
  return v == null ? null : Math.round(v);
}

const toMs = (d: Date | string | number) => (typeof d === "number" ? d : new Date(d).getTime());

// ─── Time-range bucketing ─────────────────────────────────────────────────────

export const TIME_RANGES = ["1H", "24H", "7D", "30D"] as const;
export type TimeRange = (typeof TIME_RANGES)[number];

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const RANGE_CONFIG: Record<TimeRange, { windowMs: number; bucketMs: number; label: string }> = {
  "1H": { windowMs: HOUR, bucketMs: 2 * MIN, label: "Last hour" },
  "24H": { windowMs: DAY, bucketMs: 30 * MIN, label: "Last 24 hours" },
  "7D": { windowMs: 7 * DAY, bucketMs: 4 * HOUR, label: "Last 7 days" },
  "30D": { windowMs: 30 * DAY, bucketMs: DAY, label: "Last 30 days" },
};

export function isTimeRange(v: unknown): v is TimeRange {
  return typeof v === "string" && (TIME_RANGES as readonly string[]).includes(v);
}

export interface SeriesPoint {
  /** Bucket start (epoch ms) */
  t: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  uptime: number | null;
  checks: number;
  failures: number;
}

/**
 * Group samples into fixed buckets ending at `now` and compute per-bucket
 * percentiles. Empty buckets are kept (with nulls) so the x-axis is continuous.
 */
export function bucketSeries(samples: readonly CheckSample[], range: TimeRange, now: number = Date.now()): SeriesPoint[] {
  const { windowMs, bucketMs } = RANGE_CONFIG[range];
  const end = Math.ceil(now / bucketMs) * bucketMs;
  const start = end - windowMs;
  const count = Math.round(windowMs / bucketMs);
  const groups: CheckSample[][] = Array.from({ length: count }, () => []);

  for (const s of samples) {
    const t = toMs(s.checkedAt);
    if (t < start || t >= end) continue;
    groups[Math.floor((t - start) / bucketMs)]!.push(s);
  }

  return groups.map((g, i) => {
    const stats = latencySummary(g);
    const failures = g.reduce((acc, s) => acc + (s.ok ? 0 : 1), 0);
    return {
      t: start + i * bucketMs,
      p50: stats.p50,
      p95: stats.p95,
      p99: stats.p99,
      uptime: uptimePercent(g),
      checks: g.length,
      failures,
    };
  });
}

// ─── Sparklines ───────────────────────────────────────────────────────────────

export type BarState = "ok" | "degraded" | "down" | "empty";

export interface SparkBar {
  t: number;
  latency: number | null;
  uptime: number | null;
  state: BarState;
}

/** 24 bars over the last 24h (one per hour) for the monitor registry table. */
export function sparkline(
  samples: readonly CheckSample[],
  degradedThresholdMs: number,
  now: number = Date.now(),
  bars = 24,
  windowMs = DAY,
): SparkBar[] {
  const bucketMs = windowMs / bars;
  const end = Math.ceil(now / bucketMs) * bucketMs;
  const start = end - windowMs;
  const groups: CheckSample[][] = Array.from({ length: bars }, () => []);
  for (const s of samples) {
    const t = toMs(s.checkedAt);
    if (t < start || t >= end) continue;
    groups[Math.floor((t - start) / bucketMs)]!.push(s);
  }
  return groups.map((g, i) => {
    const up = uptimePercent(g);
    const lat = latencySummary(g).p50;
    return { t: start + i * bucketMs, latency: lat, uptime: up, state: classifyBar(up, lat, degradedThresholdMs) };
  });
}

/** Colour state for one sparkline / uptime bar. */
export function classifyBar(uptime: number | null, latency: number | null, degradedThresholdMs: number): BarState {
  if (uptime == null) return "empty";
  if (uptime < 90) return "down";
  if (uptime < 100 || (latency != null && latency > degradedThresholdMs)) return "degraded";
  return "ok";
}

/** Align a window to bucket boundaries, matching `bucketSeries`. */
export function alignedWindow(windowMs: number, bucketMs: number, now: number = Date.now()) {
  const end = Math.ceil(now / bucketMs) * bucketMs;
  return { start: end - windowMs, end, count: Math.round(windowMs / bucketMs) };
}

// ─── Daily uptime (status page) ───────────────────────────────────────────────

export interface DailyUptime {
  /** UTC date key, YYYY-MM-DD */
  date: string;
  uptime: number | null;
  checks: number;
  incidents: number;
}

export function utcDayKey(d: Date | string | number): string {
  return new Date(d).toISOString().slice(0, 10);
}

/**
 * One entry per UTC day for the trailing `days` days (oldest first).
 * `incidentStarts` are incident start timestamps, counted on the day they began.
 */
export function dailyUptime(
  samples: readonly CheckSample[],
  incidentStarts: readonly (Date | string | number)[] = [],
  days = 30,
  now: number = Date.now(),
): DailyUptime[] {
  const todayStart = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) keys.push(utcDayKey(todayStart - i * DAY));

  const tally = new Map<string, { up: number; total: number; incidents: number }>(
    keys.map((k) => [k, { up: 0, total: 0, incidents: 0 }]),
  );
  for (const s of samples) {
    const row = tally.get(utcDayKey(s.checkedAt));
    if (!row) continue;
    row.total++;
    if (s.ok) row.up++;
  }
  for (const t of incidentStarts) {
    const row = tally.get(utcDayKey(t));
    if (row) row.incidents++;
  }
  return keys.map((date) => {
    const r = tally.get(date)!;
    return { date, uptime: r.total ? (r.up / r.total) * 100 : null, checks: r.total, incidents: r.incidents };
  });
}

// ─── Status derivation & incident policy ──────────────────────────────────────

export const INCIDENT_POLICY = {
  /** Consecutive failed checks that open an incident. */
  failureThreshold: 3,
  /** Consecutive successful checks that auto-resolve an open incident. */
  recoveryThreshold: 2,
} as const;

export interface CounterState {
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  hasOpenIncident: boolean;
}

export type IncidentAction = "open" | "resolve" | "none";

/**
 * Advance the rolling failure/success counters after a check and decide whether
 * the incident state machine should open or resolve an incident.
 *
 *   ok   → successes++, failures = 0; resolve if open && successes ≥ recoveryThreshold
 *   fail → failures++,  successes = 0; open    if !open && failures ≥ failureThreshold
 */
export function advanceCounters(
  prev: CounterState,
  ok: boolean,
  policy: { failureThreshold: number; recoveryThreshold: number } = INCIDENT_POLICY,
): { consecutiveFailures: number; consecutiveSuccesses: number; action: IncidentAction } {
  if (ok) {
    const successes = prev.consecutiveSuccesses + 1;
    return {
      consecutiveFailures: 0,
      consecutiveSuccesses: successes,
      action: prev.hasOpenIncident && successes >= policy.recoveryThreshold ? "resolve" : "none",
    };
  }
  const failures = prev.consecutiveFailures + 1;
  return {
    consecutiveFailures: failures,
    consecutiveSuccesses: 0,
    action: !prev.hasOpenIncident && failures >= policy.failureThreshold ? "open" : "none",
  };
}

/** Monitor status after a check, taking the open-incident state into account. */
export function deriveStatus(args: {
  ok: boolean;
  latencyMs: number;
  degradedThresholdMs: number;
  consecutiveFailures: number;
  hasOpenIncident: boolean;
  isPaused?: boolean;
}): MonitorState {
  if (args.isPaused) return "PAUSED";
  if (args.hasOpenIncident) return args.ok ? "DEGRADED" : "DOWN";
  if (!args.ok) return args.consecutiveFailures >= INCIDENT_POLICY.failureThreshold ? "DOWN" : "DEGRADED";
  return args.latencyMs > args.degradedThresholdMs ? "DEGRADED" : "OPERATIONAL";
}

/** Downtime in whole seconds between two instants. */
export function downtimeSeconds(startedAt: Date | string | number, resolvedAt: Date | string | number): number {
  return Math.max(0, Math.round((toMs(resolvedAt) - toMs(startedAt)) / 1000));
}
