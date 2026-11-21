import "server-only";
import { MonitorStatus, Prisma, type PrismaClient } from "@prisma/client";

export function toUtcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

export interface CheckStatInput {
  monitorId: string;
  checkedAt: Date;
  ok: boolean;
  status: MonitorStatus;
  latencyMs: number;
}

/**
 * Fast, atomic incremental upsert called whenever a probe saves a CheckRun.
 * Updates total checks, up/degraded/down counters, and sumLatencyMs for the current UTC day.
 */
export async function recordDailyStatCheck(
  tx: Prisma.TransactionClient | PrismaClient,
  check: CheckStatInput,
): Promise<void> {
  const day = toUtcMidnight(check.checkedAt);
  const isUp = check.ok;
  const isDegraded = check.status === MonitorStatus.DEGRADED;
  const isDown = check.status === MonitorStatus.DOWN;

  await tx.monitorDailyStat.upsert({
    where: {
      monitorId_day: {
        monitorId: check.monitorId,
        day,
      },
    },
    create: {
      monitorId: check.monitorId,
      day,
      totalChecks: 1,
      upChecks: isUp ? 1 : 0,
      degradedChecks: isDegraded ? 1 : 0,
      downChecks: isDown ? 1 : 0,
      sumLatencyMs: check.latencyMs,
    },
    update: {
      totalChecks: { increment: 1 },
      ...(isUp ? { upChecks: { increment: 1 } } : {}),
      ...(isDegraded ? { degradedChecks: { increment: 1 } } : {}),
      ...(isDown ? { downChecks: { increment: 1 } } : {}),
      sumLatencyMs: { increment: check.latencyMs },
    },
  });
}

/**
 * Background / cron recalculation helper that computes exact p50, p95, and p99
 * latencies for a given UTC day using raw CheckRun rows.
 */
export async function refreshDailyStatPercentiles(
  db: PrismaClient | Prisma.TransactionClient,
  targetDate: Date,
  monitorId?: string,
): Promise<number> {
  const dayStart = toUtcMidnight(targetDate);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const filter = monitorId ? Prisma.sql`AND "monitorId" = ${monitorId}` : Prisma.empty;

  const rows = await db.$queryRaw<
    { monitorId: string; p50: number | null; p95: number | null; p99: number | null }[]
  >`
    SELECT "monitorId",
      percentile_cont(0.50) WITHIN GROUP (ORDER BY "latencyMs") FILTER (WHERE ok OR "statusCode" IS NOT NULL) AS p50,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY "latencyMs") FILTER (WHERE ok OR "statusCode" IS NOT NULL) AS p95,
      percentile_cont(0.99) WITHIN GROUP (ORDER BY "latencyMs") FILTER (WHERE ok OR "statusCode" IS NOT NULL) AS p99
    FROM "CheckRun"
    WHERE "checkedAt" >= ${dayStart} AND "checkedAt" < ${dayEnd} ${filter}
    GROUP BY "monitorId"`;

  for (const r of rows) {
    await db.monitorDailyStat.updateMany({
      where: { monitorId: r.monitorId, day: dayStart },
      data: {
        p50Ms: r.p50 != null ? Number(r.p50) : null,
        p95Ms: r.p95 != null ? Number(r.p95) : null,
        p99Ms: r.p99 != null ? Number(r.p99) : null,
      },
    });
  }

  return rows.length;
}
