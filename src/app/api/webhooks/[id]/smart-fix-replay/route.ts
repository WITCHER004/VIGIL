import { performance } from "node:perf_hooks";
import type { Prisma } from "@prisma/client";
import { handler, json, notFound, readJson, throttle, THROTTLE } from "@/lib/api";
import { db } from "@/lib/db";
import { SIGNATURE_HEADER, signPayload } from "@/lib/hmac";
import { describeFetchError, readBodyCapped } from "@/lib/probe";
import { safeFetch, SsrfError } from "@/lib/ssrf";
import { getAppOrigin } from "@/lib/utils";
import { forwardableHeaders } from "@/lib/webhooks";
import { z } from "zod";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const smartFixSchema = z.object({
  targetUrl: z.string().optional(),
});

const ALL_SIGNATURE_HEADERS = Object.values(SIGNATURE_HEADER);

/**
 * POST /api/webhooks/:id/smart-fix-replay
 * Deterministically patches a broken webhook (regenerates HMAC signature, normalizes Content-Type)
 * and replays it through the SSRF-pinned client.
 */
export const POST = handler(async (req: Request, { params }: Ctx) => {
  await throttle(req, "replay", THROTTLE.replay);
  const { id } = await params;
  const input = await readJson(req, smartFixSchema).catch(() => ({ targetUrl: undefined }));

  const event = await db.webhookEvent.findUnique({
    where: { id },
    include: { endpoint: true, replays: { take: 1, orderBy: { createdAt: "desc" } } },
  });

  if (!event) throw notFound("Webhook event");

  const targetUrl = input.targetUrl || event.replays[0]?.targetUrl || "https://httpbin.org/post";
  const appOrigin = getAppOrigin(req.url);

  const patchesApplied: string[] = [];
  const headers: Record<string, string> = forwardableHeaders(event.headers as Record<string, string>);

  // 1. Content-Type normalization
  if (!headers["content-type"] || !headers["content-type"].includes("json")) {
    headers["content-type"] = "application/json";
    patchesApplied.push('Normalized "Content-Type: application/json"');
  }

  // 2. Cryptographic signature repair
  const { signatureScheme, secret } = event.endpoint;
  if (secret && signatureScheme !== "NONE") {
    // Remove invalid or stale signature headers
    for (const h of ALL_SIGNATURE_HEADERS) delete headers[h];
    // Calculate brand-new valid signature
    const freshSig = signPayload(signatureScheme, secret, event.rawBody);
    Object.assign(headers, freshSig);
    patchesApplied.push(`Recalculated valid ${signatureScheme} HMAC-SHA256 signature`);
  }

  headers["x-vigil-smart-replay"] = "1";
  headers["x-vigil-original-event"] = event.id;

  const start = performance.now();
  let replayRecord;

  try {
    const { response } = await safeFetch(targetUrl, appOrigin, {
      method: "POST",
      headers,
      body: event.rawBody,
      timeoutMs: 15_000,
    });

    const latencyMs = Math.round(performance.now() - start);
    const text = await readBodyCapped(response.body);

    const resHeaders: Record<string, string> = {};
    response.headers.forEach((v, k) => {
      resHeaders[k.toLowerCase()] = v;
    });

    replayRecord = await db.webhookReplay.create({
      data: {
        eventId: event.id,
        targetUrl,
        method: "POST",
        requestHeaders: headers as Prisma.InputJsonValue,
        requestBody: event.rawBody,
        responseStatus: response.status,
        responseHeaders: resHeaders as Prisma.InputJsonValue,
        responseBody: text,
        latencyMs,
        error: response.status >= 400 ? `Downstream responded with HTTP ${response.status}` : null,
      },
    });

    // Audit in RemediationLog
    const remediation = await db.remediationLog.create({
      data: {
        webhookEventId: event.id,
        actionType: "SMART_REPLAY",
        title: "Smart Fix & Replay",
        status: response.status < 400 ? "VERIFIED" : "FAILED",
        executedBy: "operator",
        responseCode: response.status,
        outputPreview: `Replayed to ${targetUrl} (HTTP ${response.status} in ${latencyMs}ms). Patches: ${patchesApplied.join(", ")}`,
        metadata: {
          patchesApplied,
          targetUrl,
          latencyMs,
        },
      },
    });

    return json({
      ok: true,
      patchesApplied,
      replay: replayRecord,
      remediation,
    });
  } catch (err: unknown) {
    const latencyMs = Math.round(performance.now() - start);
    const errorMsg = describeFetchError(err, 15_000);

    replayRecord = await db.webhookReplay.create({
      data: {
        eventId: event.id,
        targetUrl,
        method: "POST",
        requestHeaders: headers as Prisma.InputJsonValue,
        requestBody: event.rawBody,
        latencyMs,
        error: errorMsg,
      },
    });

    const remediation = await db.remediationLog.create({
      data: {
        webhookEventId: event.id,
        actionType: "SMART_REPLAY",
        title: "Smart Fix & Replay",
        status: "FAILED",
        executedBy: "operator",
        outputPreview: `Replay failed: ${errorMsg}`,
        metadata: { patchesApplied, targetUrl },
      },
    });

    return json({
      ok: false,
      patchesApplied,
      replay: replayRecord,
      remediation,
    });
  }
});
