import { handler, json, notFound, throttle, THROTTLE } from "@/lib/api";
import { db } from "@/lib/db";
import { forwardableHeaders, serializeEndpoint } from "@/lib/webhooks";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/webhooks/:id — full captured event (headers, query, raw + parsed body) with replay log. */
export const GET = handler(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const event = await db.webhookEvent.findUnique({
    where: { id },
    include: { endpoint: true, replays: { orderBy: { createdAt: "desc" }, take: 50 } },
  });
  if (!event) throw notFound("Webhook event");

  const { endpoint, ...rest } = event;
  return json({
    event: rest,
    endpoint: serializeEndpoint(endpoint),
    /** Headers the replay engine forwards by default (hop-by-hop & infra headers removed). */
    replayDefaults: {
      method: ["POST", "PUT", "PATCH"].includes(event.method) ? event.method : "POST",
      headers: forwardableHeaders(event.headers as Record<string, string>),
    },
  });
});

/** DELETE /api/webhooks/:id — discard a captured event. */
export const DELETE = handler(async (req: Request, { params }: Ctx) => {
  await throttle(req, "mutate", THROTTLE.mutate);
  const { id } = await params;
  await db.webhookEvent.delete({ where: { id } });
  return json({ deleted: true, id });
});
