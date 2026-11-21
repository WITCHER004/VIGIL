import { ApiError, handler, json, readJson, throttle, THROTTLE } from "@/lib/api";
import { db } from "@/lib/db";
import { endpointCreateSchema } from "@/lib/validation";
import { generateSecret, generateToken, serializeEndpoint } from "@/lib/webhooks";

export const dynamic = "force-dynamic";

const MAX_ENDPOINTS = 20;

/** GET /api/webhooks — capture endpoints with event counts and last-seen time. */
export const GET = handler(async () => {
  const [endpoints, stats] = await Promise.all([
    db.webhookEndpoint.findMany({ orderBy: { createdAt: "asc" } }),
    db.webhookEvent.groupBy({ by: ["endpointId"], _count: { _all: true }, _max: { receivedAt: true } }),
  ]);
  const by = new Map(stats.map((s) => [s.endpointId, s]));
  return json({
    endpoints: endpoints.map((ep) =>
      serializeEndpoint(ep, {
        eventCount: by.get(ep.id)?._count._all ?? 0,
        lastEventAt: by.get(ep.id)?._max.receivedAt ?? null,
      }),
    ),
  });
});

/**
 * POST /api/webhooks — create a capture endpoint.
 * The signing secret is returned in full exactly once, in this response.
 */
export const POST = handler(async (req: Request) => {
  await throttle(req, "mutate", THROTTLE.mutate);
  const input = await readJson(req, endpointCreateSchema);
  if ((await db.webhookEndpoint.count()) >= MAX_ENDPOINTS) {
    throw new ApiError(409, "LIMIT_REACHED", `This workspace is limited to ${MAX_ENDPOINTS} capture endpoints.`);
  }

  const secret = input.signatureScheme === "NONE" ? null : (input.secret ?? generateSecret(input.signatureScheme));
  const endpoint = await db.webhookEndpoint.create({
    data: { name: input.name, signatureScheme: input.signatureScheme, secret, token: generateToken() },
  });
  return json({ endpoint: serializeEndpoint(endpoint, { eventCount: 0, revealSecret: true }) }, { status: 201 });
});
