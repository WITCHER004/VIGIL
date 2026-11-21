import { performance } from "node:perf_hooks";
import type { Prisma } from "@prisma/client";
import { handler, json, notFound, readJson, throttle, THROTTLE } from "@/lib/api";
import { db } from "@/lib/db";
import { SIGNATURE_HEADER, signPayload } from "@/lib/hmac";
import { describeFetchError, readBodyCapped } from "@/lib/probe";
import { safeFetch, SsrfError } from "@/lib/ssrf";
import { getAppOrigin } from "@/lib/utils";
import { replaySchema } from "@/lib/validation";
import { forwardableHeaders } from "@/lib/webhooks";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string }> };

const REPLAY_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const ALL_SIGNATURE_HEADERS = Object.values(SIGNATURE_HEADER);

/**
 * POST /api/webhooks/:id/replay
 * { targetUrl, method?, body?, headers?, resign? }
 *
 * Forwards a captured payload (optionally edited) to any public URL through the
 * SSRF-pinned client and logs every attempt — including blocked and failed ones.
 */
export const POST = handler(async (req: Request, { params }: Ctx) => {
  await throttle(req, "replay", THROTTLE.replay);
  const { id } = await params;
  const input = await readJson(req, replaySchema);

  const event = await db.webhookEvent.findUnique({ where: { id }, include: { endpoint: true } });
  if (!event) throw notFound("Webhook event");

  const body = input.body ?? event.rawBody;

  // Original forwardable headers → overrides (empty string deletes) → optional re-signing.
  const headers: Record<string, string> = forwardableHeaders(event.headers as Record<string, string>);
  for (const [k, v] of Object.entries(input.headers)) {
    const key = k.toLowerCase();
    if (v === "") delete headers[key];
    else headers[key] = v;
  }
  const { signatureScheme, secret } = event.endpoint;
  if (input.resign && secret && signatureScheme !== "NONE") {
    for (const h of ALL_SIGNATURE_HEADERS) delete headers[h];
    Object.assign(headers, signPayload(signatureScheme, secret, body));
  }
  headers["x-vigil-replay"] = event.id;
  headers["content-type"] ??= event.contentType ?? "application/json";

  const record = {
    eventId: event.id,
    targetUrl: input.targetUrl,
    method: input.method,
    requestHeaders: headers as Prisma.InputJsonValue,
    requestBody: body,
  };

  const started = performance.now();
  try {
    const { response } = await safeFetch(input.targetUrl, getAppOrigin(req.url), {
      method: input.method,
      headers,
      body,
      timeoutMs: REPLAY_TIMEOUT_MS,
    });
    const responseBody = await readBodyCapped(response.body, MAX_RESPONSE_BYTES);
    const latencyMs = Math.round(performance.now() - started);
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((v, k) => {
      responseHeaders[k] = v;
    });

    const replay = await db.webhookReplay.create({
      data: {
        ...record,
        responseStatus: response.status,
        responseHeaders,
        responseBody,
        latencyMs,
        error: response.status >= 400 ? `Target responded with HTTP ${response.status}` : null,
      },
    });
    return json({ replay }, { status: 201 });
  } catch (err) {
    const latencyMs = Math.round(performance.now() - started);
    const blocked = err instanceof SsrfError || (err as { cause?: unknown })?.cause instanceof SsrfError;
    const replay = await db.webhookReplay.create({
      data: { ...record, latencyMs, error: describeFetchError(err, REPLAY_TIMEOUT_MS) },
    });
    if (blocked) {
      return json(
        { error: { code: "SSRF_BLOCKED", message: replay.error ?? "Target blocked by SSRF guard." }, replay },
        { status: 422 },
      );
    }
    return json({ replay }, { status: 201 });
  }
});
