import type { SignatureScheme } from "@prisma/client";
import { ApiError, handler, json, readJson, throttle, THROTTLE } from "@/lib/api";
import { db } from "@/lib/db";
import { signPayload } from "@/lib/hmac";
import { consumeToken, INGEST_BUCKET, rateLimitHeaders } from "@/lib/rate-limit";
import { samplePayload, type SampleProvider } from "@/lib/sample-payloads";
import { simulatorWebhookSchema } from "@/lib/validation";
import { ingestWebhook } from "@/lib/webhooks";

export const dynamic = "force-dynamic";

const PREFERRED_SCHEME: Record<SampleProvider, SignatureScheme> = {
  stripe: "STRIPE",
  github: "GITHUB",
  razorpay: "RAZORPAY",
};

/**
 * POST /api/simulator/webhook { provider: "stripe" | "github" | "razorpay", endpointId? }
 *
 * Generates a realistic provider payload, signs it with the target endpoint's
 * secret and scheme, and runs it through the exact same ingest path as an
 * external request — including the endpoint's token-bucket rate limit.
 */
export const POST = handler(async (req: Request) => {
  await throttle(req, "simulator", THROTTLE.simulator);
  const { provider, endpointId } = await readJson(req, simulatorWebhookSchema);

  const endpoint = endpointId
    ? await db.webhookEndpoint.findUnique({ where: { id: endpointId } })
    : ((await db.webhookEndpoint.findFirst({
        where: { signatureScheme: PREFERRED_SCHEME[provider] },
        orderBy: { createdAt: "asc" },
      })) ?? (await db.webhookEndpoint.findFirst({ orderBy: { createdAt: "asc" } })));
  if (!endpoint) throw new ApiError(404, "NO_ENDPOINT", "Create a webhook capture endpoint first.");

  const rl = await consumeToken(`ingest:${endpoint.token}`, INGEST_BUCKET);
  if (!rl.success) {
    throw new ApiError(429, "RATE_LIMITED", `Capture endpoint is rate limited. Retry in ${rl.retryAfterSec}s.`, {
      retryAfterSec: rl.retryAfterSec,
    }, rateLimitHeaders(rl));
  }

  const sample = samplePayload(provider);
  const rawBody = JSON.stringify(sample.body);
  const signature = endpoint.secret ? signPayload(endpoint.signatureScheme, endpoint.secret, rawBody) : {};

  const headers = new Headers({
    ...sample.headers,
    ...signature,
    "user-agent": sample.userAgent,
    "content-length": String(Buffer.byteLength(rawBody)),
    "x-vigil-simulated": "true",
  });

  const event = await ingestWebhook({
    endpoint,
    method: "POST",
    headers,
    query: {},
    rawBody,
    sourceIp: "simulator",
  });

  return json(
    {
      event: {
        id: event.id,
        endpointId: endpoint.id,
        eventType: event.eventType,
        signatureStatus: event.signatureStatus,
        sizeBytes: event.sizeBytes,
        receivedAt: event.receivedAt.toISOString(),
      },
      rateLimit: { limit: rl.limit, remaining: rl.remaining },
    },
    { status: 201, headers: rateLimitHeaders(rl) },
  );
});
