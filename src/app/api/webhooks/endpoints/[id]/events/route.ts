import { handler, json, notFound, readQuery } from "@/lib/api";
import { db } from "@/lib/db";
import { eventsQuerySchema } from "@/lib/validation";
import { eventSummarySelect } from "@/lib/webhooks";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/webhooks/endpoints/:id/events
 *   ?after=<ISO>  → only events newer than the client's latest (live stream polling)
 *   ?cursor=<id>  → older page for infinite scroll
 */
export const GET = handler(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const { after, cursor, limit } = readQuery(req, eventsQuerySchema);

  const exists = await db.webhookEndpoint.count({ where: { id } });
  if (!exists) throw notFound("Endpoint");

  const rows = await db.webhookEvent.findMany({
    where: { endpointId: id, ...(after ? { receivedAt: { gt: new Date(after) } } : {}) },
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor && !after ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: eventSummarySelect,
  });

  const hasMore = rows.length > limit;
  const events = (hasMore ? rows.slice(0, limit) : rows).map(({ _count, ...e }) => ({
    ...e,
    replayCount: _count.replays,
  }));
  return json({ events, nextCursor: hasMore && !after ? events.at(-1)!.id : null });
});
