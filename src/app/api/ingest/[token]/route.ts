import { clientIp, errorResponse, json } from "@/lib/api";
import { db } from "@/lib/db";
import { consumeToken, INGEST_BUCKET, rateLimitHeaders } from "@/lib/rate-limit";
import { ingestWebhook, MAX_INGEST_BYTES, TOKEN_PATTERN } from "@/lib/webhooks";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

/**
 * Read the request body as UTF-8, aborting once it exceeds `max` bytes.
 * Streams rather than trusting Content-Length, which chunked senders omit.
 */
async function readBodyLimited(req: Request, max: number): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Capture handler for POST / PUT / PATCH /api/ingest/:token
 *
 *   1. Token shape check (cheap reject before any I/O)
 *   2. Token-bucket rate limit per capture endpoint → 429 + Retry-After
 *   3. Size limit (512 KB) → 413
 *   4. HMAC verification per the endpoint's signature scheme
 *   5. Persist headers, query, source IP, size, raw + parsed body
 */
async function capture(req: Request, { params }: Ctx): Promise<Response> {
  try {
    const { token } = await params;
    if (!TOKEN_PATTERN.test(token)) {
      return json({ error: { code: "NOT_FOUND", message: "Unknown capture endpoint." } }, { status: 404 });
    }

    const rl = await consumeToken(`ingest:${token}`, INGEST_BUCKET);
    const rlHeaders = rateLimitHeaders(rl);
    if (!rl.success) {
      return json(
        { error: { code: "RATE_LIMITED", message: `Rate limit exceeded. Retry in ${rl.retryAfterSec}s.` } },
        { status: 429, headers: rlHeaders },
      );
    }

    const endpoint = await db.webhookEndpoint.findUnique({
      where: { token },
      select: { id: true, token: true, signatureScheme: true, secret: true },
    });
    if (!endpoint) {
      return json({ error: { code: "NOT_FOUND", message: "Unknown capture endpoint." } }, { status: 404, headers: rlHeaders });
    }

    const declared = Number(req.headers.get("content-length") ?? 0);
    const rawBody = declared > MAX_INGEST_BYTES ? null : await readBodyLimited(req, MAX_INGEST_BYTES);
    if (rawBody === null) {
      return json(
        { error: { code: "PAYLOAD_TOO_LARGE", message: `Payload exceeds ${MAX_INGEST_BYTES / 1024} KB.` } },
        { status: 413, headers: rlHeaders },
      );
    }

    const url = new URL(req.url);
    const event = await ingestWebhook({
      endpoint,
      method: req.method,
      headers: req.headers,
      query: Object.fromEntries(url.searchParams),
      rawBody,
      sourceIp: clientIp(req),
    });

    return json(
      {
        received: true,
        id: event.id,
        eventType: event.eventType,
        signature: event.signatureStatus,
        sizeBytes: event.sizeBytes,
        receivedAt: event.receivedAt.toISOString(),
      },
      { status: 202, headers: rlHeaders },
    );
  } catch (err) {
    return errorResponse(err);
  }
}

export const POST = capture;
export const PUT = capture;
export const PATCH = capture;

/** GET is answered (some providers ping the URL on setup) but never stored. */
export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  const { token } = await params;
  const exists = TOKEN_PATTERN.test(token) && (await db.webhookEndpoint.count({ where: { token } })) > 0;
  if (!exists) return json({ error: { code: "NOT_FOUND", message: "Unknown capture endpoint." } }, { status: 404 });
  return json(
    { ok: true, message: "Vigil capture endpoint. Send POST, PUT or PATCH requests to record them." },
    { headers: { Allow: "GET, POST, PUT, PATCH" } },
  );
}
