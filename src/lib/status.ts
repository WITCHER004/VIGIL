import "server-only";
import { IncidentStatus, Prisma } from "@prisma/client";
import { db } from "./db";
import { utcTimestamp } from "./sql";
import type { DailyUptime } from "./stats";

/**
 * Public status page read model: 30 UTC-day uptime bars per component plus
 * chronological incident dispatches. Contains nothing operator-private
 * (no URLs, no internal error strings beyond the incident timeline).
 */

const DAY = 86_400_000;
const DAYS = 30;

export type OverallState = "OPERATIONAL" | "DEGRADED" | "PARTIAL_OUTAGE" | "MAJOR_OUTAGE";

interface DayRow {
  monitorId: string;
  day: string;
  total: number;
  up: number;
}

export async function getStatusPage(slug: string, now = Date.now()) {
  const page = await db.statusPage.findUnique({
    where: { slug },
    include: { monitors: { orderBy: { name: "asc" } } },
  });
  if (!page) return null;

  const ids = page.monitors.map((m) => m.id);
  const todayStart = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
  const from = new Date(todayStart - (DAYS - 1) * DAY);
  const dayKeys = Array.from({ length: DAYS }, (_, i) => new Date(from.getTime() + i * DAY).toISOString().slice(0, 10));

  const [rows, incidents] = await Promise.all([
    ids.length
      ? db.$queryRaw<DayRow[]>`
          SELECT "monitorId",
            to_char(date_trunc('day', "checkedAt"), 'YYYY-MM-DD') AS day,
            count(*)::int AS total,
            (count(*) FILTER (WHERE ok))::int AS up
          FROM "CheckRun"
          WHERE "monitorId" IN (${Prisma.join(ids)}) AND "checkedAt" >= ${utcTimestamp(from)}
          GROUP BY 1, 2`
      : Promise.resolve([] as DayRow[]),
    db.incident.findMany({
      where: {
        monitorId: { in: ids },
        OR: [{ startedAt: { gte: from } }, { status: { not: IncidentStatus.RESOLVED } }],
      },
      orderBy: { startedAt: "desc" },
      include: {
        monitor: { select: { id: true, name: true } },
        updates: { orderBy: { createdAt: "desc" } },
      },
    }),
  ]);

  const tally = new Map<string, DayRow>();
  for (const r of rows) tally.set(`${r.monitorId}:${r.day}`, r);
  const incidentTally = new Map<string, number>();
  for (const i of incidents) {
    const key = `${i.monitorId}:${i.startedAt.toISOString().slice(0, 10)}`;
    incidentTally.set(key, (incidentTally.get(key) ?? 0) + 1);
  }

  const components = page.monitors.map((m) => {
    let up = 0;
    let total = 0;
    const days: DailyUptime[] = dayKeys.map((date) => {
      const r = tally.get(`${m.id}:${date}`);
      if (r) {
        up += r.up;
        total += r.total;
      }
      return {
        date,
        uptime: r && r.total > 0 ? (r.up / r.total) * 100 : null,
        checks: r?.total ?? 0,
        incidents: incidentTally.get(`${m.id}:${date}`) ?? 0,
      };
    });
    return {
      id: m.id,
      name: m.name,
      status: m.status,
      uptime30d: total > 0 ? (up / total) * 100 : null,
      days,
    };
  });

  const live = components.filter((c) => c.status !== "PAUSED");
  const down = live.filter((c) => c.status === "DOWN").length;
  const degraded = live.filter((c) => c.status === "DEGRADED").length;
  const overall: OverallState =
    down > 0 && down >= Math.ceil(live.length / 2)
      ? "MAJOR_OUTAGE"
      : down > 0
        ? "PARTIAL_OUTAGE"
        : degraded > 0
          ? "DEGRADED"
          : "OPERATIONAL";

  return {
    slug: page.slug,
    title: page.title,
    description: page.description,
    generatedAt: new Date(now).toISOString(),
    overall,
    components,
    incidents: incidents.map((i) => ({
      id: i.id,
      title: i.title,
      status: i.status,
      severity: i.severity,
      component: i.monitor.name,
      startedAt: i.startedAt.toISOString(),
      resolvedAt: i.resolvedAt?.toISOString() ?? null,
      downtimeSec: i.downtimeSec,
      updates: i.updates.map((u) => ({
        id: u.id,
        status: u.status,
        message: u.message,
        createdAt: u.createdAt.toISOString(),
      })),
    })),
  };
}

export type StatusPageData = NonNullable<Awaited<ReturnType<typeof getStatusPage>>>;
