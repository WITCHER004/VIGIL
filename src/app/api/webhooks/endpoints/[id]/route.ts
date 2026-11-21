import { handler, json, notFound, readJson, throttle, THROTTLE } from "@/lib/api";
import { db } from "@/lib/db";
import { peekBucket, INGEST_BUCKET } from "@/lib/rate-limit";
import { endpointUpdateSchema } from "@/lib/validation";
import { generateSecret, serializeEndpoint } from "@/lib/webhooks";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/webhooks/endpoints/:id — endpoint, live rate-limit meter, 24h signature breakdown. */
export const GET = handler(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const endpoint = await db.webhookEndpoint.findUnique({ where: { id } });
  if (!endpoint) throw notFound("Endpoint");

  const since = new Date(Date.now() - 86_400_000);
  const [count, last, signatures, bucket] = await Promise.all([
    db.webhookEvent.count({ where: { endpointId: id } }),
    db.webhookEvent.findFirst({ where: { endpointId: id }, orderBy: { receivedAt: "desc" }, select: { receivedAt: true } }),
    db.webhookEvent.groupBy({
      by: ["signatureStatus"],
      where: { endpointId: id, receivedAt: { gte: since } },
      _count: { _all: true },
    }),
    peekBucket(`ingest:${endpoint.token}`),
  ]);

  return json({
    endpoint: serializeEndpoint(endpoint, { eventCount: count, lastEventAt: last?.receivedAt ?? null }),
    rateLimit: {
      limit: bucket.limit,
      remaining: bucket.remaining,
      refillPerSec: INGEST_BUCKET.refillPerSec,
      resetSec: bucket.resetSec,
      backend: bucket.backend,
    },
    signatures24h: Object.fromEntries(signatures.map((s) => [s.signatureStatus, s._count._all])),
  });
});

/** PATCH /api/webhooks/endpoints/:id — rename, change scheme, or rotate the secret (revealed once). */
export const PATCH = handler(async (req: Request, { params }: Ctx) => {
  await throttle(req, "mutate", THROTTLE.mutate);
  const { id } = await params;
  const input = await readJson(req, endpointUpdateSchema);
  const existing = await db.webhookEndpoint.findUnique({ where: { id } });
  if (!existing) throw notFound("Endpoint");

  const scheme = input.signatureScheme ?? existing.signatureScheme;
  let secret = existing.secret;
  let reveal = false;
  if (scheme === "NONE") {
    secret = null;
  } else if (input.rotateSecret || !secret || (input.signatureScheme && input.signatureScheme !== existing.signatureScheme)) {
    secret = generateSecret(scheme);
    reveal = true;
  }

  const endpoint = await db.webhookEndpoint.update({
    where: { id },
    data: { name: input.name ?? existing.name, signatureScheme: scheme, secret },
  });
  return json({ endpoint: serializeEndpoint(endpoint, { revealSecret: reveal }) });
});

/** DELETE /api/webhooks/endpoints/:id — removes the endpoint and every captured event. */
export const DELETE = handler(async (req: Request, { params }: Ctx) => {
  await throttle(req, "mutate", THROTTLE.mutate);
  const { id } = await params;
  await db.webhookEndpoint.delete({ where: { id } });
  return json({ deleted: true, id });
});
