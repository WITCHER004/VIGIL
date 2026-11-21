import "server-only";
import { IncidentStatus, Prisma, type Monitor } from "@prisma/client";
import { db } from "./db";
import { toUtcMidnight } from "./rollups";
import { utcTimestamp } from "./sql";
import {
  alignedWindow,
  classifyBar,
  median,
  RANGE_CONFIG,
  type SeriesPoint,
  type SparkBar,
  type TimeRange,
} from "./stats";

/**
 * Read models for dashboards. Percentiles are computed in Postgres with
 * `percentile_cont` (same R-7 interpolation as `stats.percentile`) so a 30-day
 * window never streams tens of thousands of rows into the function.
 *
 * Latency percentiles only include checks that received an HTTP response;
 * timeouts count against uptime, not latency.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const toNum = (v: unknown): number | null => (v == null ? null : Math.round(Number(v)));
const pct = (up: number, total: number) => (total > 0 ? (up / total) * 100 : null);

// ─── Latency series ───────────────────────────────────────────────────────────

interface SeriesRow {
  b: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  checks: number;
  failures: number;
}

/** Bucketed p50/p95/p99 for one monitor, or across all active monitors when `monitorId` is omitted. */
export async function getLatencySeries(range: TimeRange, monitorId?: string, now = Date.now()): Promise<SeriesPoint[]> {
  const { windowMs, bucketMs } = RANGE_CONFIG[range];
  const { start, end, count } = alignedWindow(windowMs, bucketMs, now);
  const scope = monitorId
    ? Prisma.sql`AND c."monitorId" = ${monitorId}`
    : Prisma.sql`AND c."monitorId" IN (SELECT id FROM "Monitor" WHERE "isPaused" = false)`;

  const rows = await db.$queryRaw<SeriesRow[]>`
    SELECT
      floor((extract(epoch FROM c."checkedAt") * 1000 - ${start}::float8) / ${bucketMs}::float8)::int AS b,
      percentile_cont(0.50) WITHIN GROUP (ORDER BY c."latencyMs") FILTER (WHERE c.ok OR c."statusCode" IS NOT NULL) AS p50,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY c."latencyMs") FILTER (WHERE c.ok OR c."statusCode" IS NOT NULL) AS p95,
      percentile_cont(0.99) WITHIN GROUP (ORDER BY c."latencyMs") FILTER (WHERE c.ok OR c."statusCode" IS NOT NULL) AS p99,
      count(*)::int AS checks,
      (count(*) FILTER (WHERE NOT c.ok))::int AS failures
    FROM "CheckRun" c
    WHERE c."checkedAt" >= ${utcTimestamp(start)} AND c."checkedAt" < ${utcTimestamp(end)} ${scope}
    GROUP BY 1
    ORDER BY 1`;

  const byBucket = new Map(rows.map((r) => [Number(r.b), r]));
  return Array.from({ length: count }, (_, i) => {
    const r = byBucket.get(i);
    return {
      t: start + i * bucketMs,
      p50: toNum(r?.p50),
      p95: toNum(r?.p95),
      p99: toNum(r?.p99),
      uptime: r ? pct(r.checks - r.failures, r.checks) : null,
      checks: r?.checks ?? 0,
      failures: r?.failures ?? 0,
    };
  });
}

// ─── Monitor summaries ────────────────────────────────────────────────────────

export interface MonitorSummary {
  id: string;
  name: string;
  url: string;
  method: Monitor["method"];
  status: Monitor["status"];
  isPaused: boolean;
  intervalSec: number;
  timeoutMs: number;
  expectedStatus: number;
  bodyContains: string | null;
  degradedThresholdMs: number;
  showOnStatusPage: boolean;
  lastCheckedAt: string | null;
  lastLatencyMs: number | null;
  lastStatusCode: number | null;
  consecutiveFailures: number;
  uptime24h: number | null;
  uptime7d: number | null;
  uptime30d: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  checks24h: number;
  sparkline: SparkBar[];
  openIncident: { id: string; title: string; status: IncidentStatus; startedAt: string } | null;
}

interface Window24Row {
  monitorId: string;
  total24: number;
  up24: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
}

interface StatRollupRow {
  monitorId: string;
  total7: number;
  up7: number;
  total30: number;
  up30: number;
}

interface SparkRow {
  monitorId: string;
  b: number;
  total: number;
  up: number;
  p50: number | null;
}

/** Registry rows: rolling uptime, 24h percentiles, 24-bar sparkline and open incident. */
export async function getMonitorSummaries(opts: { ids?: string[]; now?: number } = {}): Promise<MonitorSummary[]> {
  const now = opts.now ?? Date.now();
  const d1 = utcTimestamp(now - DAY);
  const day7Utc = toUtcMidnight(new Date(now - 7 * DAY));
  const day30Utc = toUtcMidnight(new Date(now - 30 * DAY));
  const spark = alignedWindow(DAY, HOUR, now);
  const idFilter = opts.ids?.length ? Prisma.sql`AND "monitorId" IN (${Prisma.join(opts.ids)})` : Prisma.empty;

  const [monitors, windows24, statRollups, sparkRows, openIncidents] = await Promise.all([
    db.monitor.findMany({
      where: opts.ids ? { id: { in: opts.ids } } : undefined,
      orderBy: [{ isPaused: "asc" }, { name: "asc" }],
    }),
    // 24H high-resolution query scans only the last 24 hours of CheckRun
    db.$queryRaw<Window24Row[]>`
      SELECT "monitorId",
        count(*)::int                                                      AS total24,
        (count(*) FILTER (WHERE ok))::int                                  AS up24,
        percentile_cont(0.50) WITHIN GROUP (ORDER BY "latencyMs")
          FILTER (WHERE (ok OR "statusCode" IS NOT NULL))                  AS p50,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY "latencyMs")
          FILTER (WHERE (ok OR "statusCode" IS NOT NULL))                  AS p95,
        percentile_cont(0.99) WITHIN GROUP (ORDER BY "latencyMs")
          FILTER (WHERE (ok OR "statusCode" IS NOT NULL))                  AS p99
      FROM "CheckRun"
      WHERE "checkedAt" >= ${d1} ${idFilter}
      GROUP BY "monitorId"`,
    // 7D and 30D queries read fast pre-aggregated daily rollups (at most 30 rows per monitor)
    db.$queryRaw<StatRollupRow[]>`
      SELECT "monitorId",
        COALESCE(SUM("totalChecks") FILTER (WHERE "day" >= ${day7Utc}), 0)::int AS total7,
        COALESCE(SUM("upChecks") FILTER (WHERE "day" >= ${day7Utc}), 0)::int    AS up7,
        COALESCE(SUM("totalChecks"), 0)::int                                    AS total30,
        COALESCE(SUM("upChecks"), 0)::int                                       AS up30
      FROM "MonitorDailyStat"
      WHERE "day" >= ${day30Utc} ${idFilter}
      GROUP BY "monitorId"`,
    db.$queryRaw<SparkRow[]>`
      SELECT "monitorId",
        floor((extract(epoch FROM "checkedAt") * 1000 - ${spark.start}::float8) / ${HOUR}::float8)::int AS b,
        count(*)::int AS total,
        (count(*) FILTER (WHERE ok))::int AS up,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY "latencyMs") FILTER (WHERE ok OR "statusCode" IS NOT NULL) AS p50
      FROM "CheckRun"
      WHERE "checkedAt" >= ${utcTimestamp(spark.start)} AND "checkedAt" < ${utcTimestamp(spark.end)} ${idFilter}
      GROUP BY 1, 2`,
    db.incident.findMany({
      where: { status: { not: IncidentStatus.RESOLVED }, ...(opts.ids ? { monitorId: { in: opts.ids } } : {}) },
      orderBy: { startedAt: "desc" },
      select: { id: true, monitorId: true, title: true, status: true, startedAt: true },
    }),
  ]);

  const windowBy = new Map(windows24.map((w) => [w.monitorId, w]));
  const statBy = new Map(statRollups.map((s) => [s.monitorId, s]));
  const sparkBy = new Map<string, Map<number, SparkRow>>();
  for (const r of sparkRows) {
    const m = sparkBy.get(r.monitorId) ?? new Map<number, SparkRow>();
    m.set(Number(r.b), r);
    sparkBy.set(r.monitorId, m);
  }
  const incidentBy = new Map<string, (typeof openIncidents)[number]>();
  for (const i of openIncidents) if (!incidentBy.has(i.monitorId)) incidentBy.set(i.monitorId, i);

  return monitors.map((m) => {
    const w = windowBy.get(m.id);
    const stat = statBy.get(m.id);
    const bars = sparkBy.get(m.id);
    const inc = incidentBy.get(m.id);

    const total7 = stat && stat.total7 > 0 ? stat.total7 : (w?.total24 ?? 0);
    const up7 = stat && stat.total7 > 0 ? stat.up7 : (w?.up24 ?? 0);
    const total30 = stat && stat.total30 > 0 ? stat.total30 : (w?.total24 ?? 0);
    const up30 = stat && stat.total30 > 0 ? stat.up30 : (w?.up24 ?? 0);

    return {
      id: m.id,
      name: m.name,
      url: m.url,
      method: m.method,
      status: m.status,
      isPaused: m.isPaused,
      intervalSec: m.intervalSec,
      timeoutMs: m.timeoutMs,
      expectedStatus: m.expectedStatus,
      bodyContains: m.bodyContains,
      degradedThresholdMs: m.degradedThresholdMs,
      showOnStatusPage: m.statusPageId != null,
      lastCheckedAt: m.lastCheckedAt?.toISOString() ?? null,
      lastLatencyMs: m.lastLatencyMs,
      lastStatusCode: m.lastStatusCode,
      consecutiveFailures: m.consecutiveFailures,
      uptime24h: w ? pct(w.up24, w.total24) : null,
      uptime7d: total7 > 0 ? pct(up7, total7) : null,
      uptime30d: total30 > 0 ? pct(up30, total30) : null,
      p50: toNum(w?.p50),
      p95: toNum(w?.p95),
      p99: toNum(w?.p99),
      checks24h: w?.total24 ?? 0,
      sparkline: Array.from({ length: spark.count }, (_, i) => {
        const r = bars?.get(i);
        const uptime = r ? pct(r.up, r.total) : null;
        const latency = toNum(r?.p50);
        return { t: spark.start + i * HOUR, latency, uptime, state: classifyBar(uptime, latency, m.degradedThresholdMs) };
      }),
      openIncident: inc
        ? { id: inc.id, title: inc.title, status: inc.status, startedAt: inc.startedAt.toISOString() }
        : null,
    };
  });
}

// ─── Monitor detail ───────────────────────────────────────────────────────────

interface RangeRow {
  total: number;
  up: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  mean: number | null;
  min: number | null;
  max: number | null;
}

export async function getMonitorDetail(id: string, range: TimeRange, now = Date.now()) {
  const [summary] = await getMonitorSummaries({ ids: [id], now });
  if (!summary) return null;

  const since = utcTimestamp(now - RANGE_CONFIG[range].windowMs);
  const daySinceUtc = toUtcMidnight(new Date(now - RANGE_CONFIG[range].windowMs));
  const responded = Prisma.sql`(ok OR "statusCode" IS NOT NULL)`;

  const fetchStats = async (): Promise<RangeRow | undefined> => {
    if (range === "7D" || range === "30D") {
      const [daily] = await db.$queryRaw<RangeRow[]>`
        SELECT
          COALESCE(SUM("totalChecks"), 0)::int AS total,
          COALESCE(SUM("upChecks"), 0)::int    AS up,
          percentile_cont(0.50) WITHIN GROUP (ORDER BY "p50Ms") FILTER (WHERE "p50Ms" IS NOT NULL) AS p50,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY "p95Ms") FILTER (WHERE "p95Ms" IS NOT NULL) AS p95,
          percentile_cont(0.99) WITHIN GROUP (ORDER BY "p99Ms") FILTER (WHERE "p99Ms" IS NOT NULL) AS p99,
          CASE WHEN SUM("totalChecks") > 0 THEN (SUM("sumLatencyMs") / SUM("totalChecks"))::float8 ELSE NULL END AS mean,
          MIN("p50Ms")::float8                 AS min,
          MAX("p99Ms")::float8                 AS max
        FROM "MonitorDailyStat"
        WHERE "monitorId" = ${id} AND "day" >= ${daySinceUtc}`;
      if (daily && daily.total > 0) return daily;
    }
    const [raw] = await db.$queryRaw<RangeRow[]>`
      SELECT count(*)::int AS total,
        (count(*) FILTER (WHERE ok))::int AS up,
        percentile_cont(0.50) WITHIN GROUP (ORDER BY "latencyMs") FILTER (WHERE ${responded}) AS p50,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY "latencyMs") FILTER (WHERE ${responded}) AS p95,
        percentile_cont(0.99) WITHIN GROUP (ORDER BY "latencyMs") FILTER (WHERE ${responded}) AS p99,
        avg("latencyMs") FILTER (WHERE ${responded}) AS mean,
        min("latencyMs") FILTER (WHERE ${responded}) AS min,
        max("latencyMs") FILTER (WHERE ${responded}) AS max
      FROM "CheckRun" WHERE "monitorId" = ${id} AND "checkedAt" >= ${since}`;
    return raw;
  };

  const [series, stats, statusCodes, lastCheck, incidents] = await Promise.all([
    getLatencySeries(range, id, now),
    fetchStats(),
    db.$queryRaw<{ statusCode: number | null; count: number }[]>`
      SELECT "statusCode", count(*)::int AS count
      FROM "CheckRun" WHERE "monitorId" = ${id} AND "checkedAt" >= ${since}
      GROUP BY 1 ORDER BY 2 DESC`,
    db.checkRun.findFirst({ where: { monitorId: id }, orderBy: { checkedAt: "desc" } }),
    db.incident.findMany({
      where: { monitorId: id },
      orderBy: { startedAt: "desc" },
      take: 10,
      include: { updates: { orderBy: { createdAt: "asc" } } },
    }),
  ]);

  return {
    monitor: summary,
    range,
    stats: {
      checks: stats?.total ?? 0,
      failures: (stats?.total ?? 0) - (stats?.up ?? 0),
      uptime: stats ? pct(stats.up, stats.total) : null,
      p50: toNum(stats?.p50),
      p95: toNum(stats?.p95),
      p99: toNum(stats?.p99),
      mean: toNum(stats?.mean),
      min: toNum(stats?.min),
      max: toNum(stats?.max),
    },
    series,
    statusCodes: statusCodes.map((s) => ({ statusCode: s.statusCode, count: Number(s.count) })),
    lastCheck,
    incidents,
  };
}

export type MonitorDetail = NonNullable<Awaited<ReturnType<typeof getMonitorDetail>>>;

// ─── Overview ─────────────────────────────────────────────────────────────────

export async function getOverview(range: TimeRange, now = Date.now()) {
  const d1 = new Date(now - DAY);
  const d2 = new Date(now - 2 * DAY);
  const [monitors, series, activeIncidents, webhooks24h, webhooksPrev24h, recentIncidents] = await Promise.all([
    getMonitorSummaries({ now }),
    getLatencySeries(range, undefined, now),
    db.incident.count({ where: { status: { not: IncidentStatus.RESOLVED } } }),
    db.webhookEvent.count({ where: { receivedAt: { gte: d1 } } }),
    db.webhookEvent.count({ where: { receivedAt: { gte: d2, lt: d1 } } }),
    db.incident.findMany({
      orderBy: { startedAt: "desc" },
      take: 6,
      include: {
        monitor: { select: { id: true, name: true } },
        updates: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    }),
  ]);

  const active = monitors.filter((m) => !m.isPaused);
  let up = 0;
  let total = 0;
  for (const m of active) {
    if (m.uptime24h == null) continue;
    up += (m.uptime24h / 100) * m.checks24h;
    total += m.checks24h;
  }

  const systemStatus = active.some((m) => m.status === "DOWN")
    ? "MAJOR_OUTAGE"
    : active.some((m) => m.status === "DEGRADED")
      ? "DEGRADED"
      : "OPERATIONAL";

  return {
    generatedAt: new Date(now).toISOString(),
    systemStatus,
    kpis: {
      globalUptime: total > 0 ? (up / total) * 100 : null,
      medianP95: median(active.map((m) => m.p95)),
      activeIncidents,
      webhooks24h,
      webhooksPrev24h,
      monitorsActive: active.length,
      monitorsTotal: monitors.length,
    },
    range,
    series,
    monitors,
    recentIncidents,
  };
}

export type Overview = Awaited<ReturnType<typeof getOverview>>;
