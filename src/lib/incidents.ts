import "server-only";
import {
  IncidentSeverity,
  IncidentStatus,
  UpdateAuthor,
  type Incident,
  type Monitor,
  type Prisma,
} from "@prisma/client";
import { ApiError, notFound } from "./api";
import { db } from "./db";
import { advanceCounters, downtimeSeconds, INCIDENT_POLICY, type IncidentAction } from "./stats";
import { formatDuration } from "./utils";

/**
 * Incident state machine.
 *
 *   (3 consecutive failures) ──open──▶ INVESTIGATING ──▶ IDENTIFIED ──▶ RESOLVED
 *                                            └──────────────────────────▲
 *   (2 consecutive successes) ───────────── auto-resolve ───────────────┘
 *
 * Transitions are forward-only. Automatic transitions are applied inside the
 * probe transaction (under a per-monitor advisory lock) so concurrent probes
 * can never open duplicate incidents.
 */

export const ALLOWED_TRANSITIONS: Record<IncidentStatus, readonly IncidentStatus[]> = {
  INVESTIGATING: [IncidentStatus.IDENTIFIED, IncidentStatus.RESOLVED],
  IDENTIFIED: [IncidentStatus.RESOLVED],
  RESOLVED: [],
};

export interface CheckOutcome {
  ok: boolean;
  statusCode: number | null;
  error: string | null;
  checkedAt: Date;
}

function severityFor(check: CheckOutcome): IncidentSeverity {
  if (check.statusCode == null) return IncidentSeverity.CRITICAL; // timeout / connection failure
  if (check.statusCode >= 500) return IncidentSeverity.MAJOR;
  return IncidentSeverity.MINOR; // unexpected 2xx-4xx or failed body assertion
}

function failureReason(check: CheckOutcome): string {
  if (check.statusCode == null) return check.error ?? "no response";
  return check.error ?? `HTTP ${check.statusCode}`;
}

/**
 * Advance the monitor's rolling counters for a freshly recorded check and
 * open / resolve incidents as required. Must run inside a transaction that
 * already holds the monitor's advisory lock and has inserted the CheckRun.
 */
export async function applyCheckToIncidents(
  tx: Prisma.TransactionClient,
  monitor: Pick<Monitor, "id" | "name" | "consecutiveFailures" | "consecutiveSuccesses">,
  check: CheckOutcome,
): Promise<{
  action: IncidentAction;
  incidentId: string | null;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  hasOpenIncident: boolean;
}> {
  const open = await tx.incident.findFirst({
    where: { monitorId: monitor.id, status: { not: IncidentStatus.RESOLVED } },
    orderBy: { startedAt: "desc" },
    select: { id: true, startedAt: true },
  });

  const next = advanceCounters(
    {
      consecutiveFailures: monitor.consecutiveFailures,
      consecutiveSuccesses: monitor.consecutiveSuccesses,
      hasOpenIncident: Boolean(open),
    },
    check.ok,
  );

  if (next.action === "open") {
    // Downtime starts at the first failure of the current streak.
    const streak = await tx.checkRun.findMany({
      where: { monitorId: monitor.id },
      orderBy: { checkedAt: "desc" },
      take: Math.min(next.consecutiveFailures, 200),
      select: { checkedAt: true },
    });
    const startedAt = streak.at(-1)?.checkedAt ?? check.checkedAt;
    const reason = failureReason(check);
    const incident = await tx.incident.create({
      data: {
        monitorId: monitor.id,
        title: `${monitor.name} is failing — ${reason}`.slice(0, 180),
        severity: severityFor(check),
        status: IncidentStatus.INVESTIGATING,
        startedAt,
        updates: {
          create: {
            status: IncidentStatus.INVESTIGATING,
            author: UpdateAuthor.SYSTEM,
            message: `${next.consecutiveFailures} consecutive failed checks — ${reason}. Incident opened automatically.`,
            createdAt: check.checkedAt,
          },
        },
      },
      select: { id: true },
    });
    return { ...next, incidentId: incident.id, hasOpenIncident: true };
  }

  if (next.action === "resolve" && open) {
    const downtimeSec = downtimeSeconds(open.startedAt, check.checkedAt);
    await tx.incident.update({
      where: { id: open.id },
      data: {
        status: IncidentStatus.RESOLVED,
        resolvedAt: check.checkedAt,
        downtimeSec,
        updates: {
          create: {
            status: IncidentStatus.RESOLVED,
            author: UpdateAuthor.SYSTEM,
            message: `${INCIDENT_POLICY.recoveryThreshold} consecutive successful checks. Auto-resolved after ${formatDuration(
              downtimeSec,
            )} of downtime.`,
            createdAt: check.checkedAt,
          },
        },
      },
    });
    return { ...next, incidentId: open.id, hasOpenIncident: false };
  }

  return { ...next, incidentId: open?.id ?? null, hasOpenIncident: Boolean(open) };
}

// ─── Operator actions ─────────────────────────────────────────────────────────

const incidentInclude = {
  monitor: { select: { id: true, name: true, url: true, status: true } },
  updates: { orderBy: { createdAt: "asc" } },
} satisfies Prisma.IncidentInclude;

export type IncidentWithTimeline = Prisma.IncidentGetPayload<{ include: typeof incidentInclude }>;

export async function getIncident(id: string): Promise<IncidentWithTimeline> {
  const incident = await db.incident.findUnique({ where: { id }, include: incidentInclude });
  if (!incident) throw notFound("Incident");
  return incident;
}

function assertTransition(from: IncidentStatus, to: IncidentStatus) {
  if (from === to) return;
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new ApiError(409, "INVALID_TRANSITION", `Cannot move an incident from ${from} to ${to}.`, {
      allowed: ALLOWED_TRANSITIONS[from],
    });
  }
}

/** Post an operator note, optionally advancing the status. */
export async function addOperatorUpdate(
  id: string,
  { message, status }: { message?: string; status?: IncidentStatus },
): Promise<IncidentWithTimeline> {
  await db.$transaction(async (tx) => {
    const current: Incident | null = await tx.incident.findUnique({ where: { id } });
    if (!current) throw notFound("Incident");
    const target = status ?? current.status;
    assertTransition(current.status, target);
    if (current.status === IncidentStatus.RESOLVED && !message) {
      throw new ApiError(409, "ALREADY_RESOLVED", "Incident is already resolved.");
    }

    const now = new Date();
    const resolving = target === IncidentStatus.RESOLVED && current.status !== IncidentStatus.RESOLVED;
    const downtimeSec = resolving ? downtimeSeconds(current.startedAt, now) : undefined;

    await tx.incident.update({
      where: { id },
      data: {
        status: target,
        ...(resolving ? { resolvedAt: now, downtimeSec } : {}),
        updates: {
          create: {
            status: target,
            author: UpdateAuthor.OPERATOR,
            message:
              message ??
              (resolving
                ? `Marked resolved by operator after ${formatDuration(downtimeSec)} of downtime.`
                : `Status changed to ${target}.`),
            createdAt: now,
          },
        },
      },
    });
  });
  return getIncident(id);
}


/** Incident log with timelines and per-state counts (shared by GET /api/incidents and the Incidents page). */
export async function listIncidents({
  status = "all",
  monitorId,
  limit = 50,
}: { status?: "active" | "resolved" | "all"; monitorId?: string; limit?: number } = {}) {
  const where: Prisma.IncidentWhereInput = {
    ...(monitorId ? { monitorId } : {}),
    ...(status === "active"
      ? { status: { not: IncidentStatus.RESOLVED } }
      : status === "resolved"
        ? { status: IncidentStatus.RESOLVED }
        : {}),
  };

  const [incidents, grouped] = await Promise.all([
    db.incident.findMany({
      where,
      // Active incidents first, then most recent.
      orderBy: [{ resolvedAt: { sort: "desc", nulls: "first" } }, { startedAt: "desc" }],
      take: limit,
      include: incidentInclude,
    }),
    db.incident.groupBy({ by: ["status"], where: monitorId ? { monitorId } : undefined, _count: { _all: true } }),
  ]);

  const tally = Object.fromEntries(grouped.map((c) => [c.status, c._count._all])) as Partial<Record<IncidentStatus, number>>;
  return {
    incidents,
    counts: {
      active: (tally.INVESTIGATING ?? 0) + (tally.IDENTIFIED ?? 0),
      resolved: tally.RESOLVED ?? 0,
      all: Object.values(tally).reduce((a, b) => a + (b ?? 0), 0),
    },
  };
}

export type IncidentList = Awaited<ReturnType<typeof listIncidents>>;

export { incidentInclude };
