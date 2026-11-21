import "server-only";
import { Prisma, type SignatureScheme, type WebhookEndpoint, type WebhookEvent } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { db } from "./db";
import { verifySignature } from "./hmac";
import { detectEventType } from "./sample-payloads";

/**
 * Webhook capture: token / secret generation, header hygiene, ingestion,
 * retention, and safe serialisation (secrets are never returned in full
 * except once at creation / rotation).
 */

export const MAX_INGEST_BYTES = 512 * 1024;
export const EVENTS_RETAINED_PER_ENDPOINT = 500;
export const TOKEN_PATTERN = /^whk_[A-Za-z0-9_-]{8,64}$/;

export function generateToken(): string {
  return `whk_${randomBytes(12).toString("base64url")}`;
}

export function generateSecret(scheme: SignatureScheme): string {
  const raw = randomBytes(24).toString("base64url");
  return scheme === "STRIPE" ? `whsec_${raw}` : raw;
}

export function maskSecret(secret: string | null): string | null {
  if (!secret) return null;
  return secret.length <= 10 ? "••••••" : `${secret.slice(0, 6)}••••${secret.slice(-4)}`;
}

// ─── Header hygiene ───────────────────────────────────────────────────────────

const REDACTED_HEADERS = new Set(["authorization", "proxy-authorization", "cookie", "set-cookie"]);
const DROPPED_PREFIXES = ["x-vercel-", "x-middleware-", "x-invoke-", "next-", "cf-"];
const DROPPED_HEADERS = new Set(["x-matched-path", "forwarded", "via"]);

/** Lower-cased header map for storage. Credentials are redacted; platform internals dropped. */
export function sanitizeHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (DROPPED_HEADERS.has(k) || DROPPED_PREFIXES.some((p) => k.startsWith(p))) return;
    out[k] = REDACTED_HEADERS.has(k) ? "[redacted]" : value;
  });
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/** Headers that must never be forwarded on replay (hop-by-hop, infra, or credentials). */
const NON_FORWARDABLE = new Set([
  "host",
  "content-length",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer",
  "accept-encoding",
  "authorization",
  "proxy-authorization",
  "cookie",
  "x-real-ip",
  "forwarded",
  "via",
]);

export function forwardableHeaders(stored: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(stored)) {
    const key = k.toLowerCase();
    if (NON_FORWARDABLE.has(key) || key.startsWith("x-forwarded-") || key.startsWith("proxy-")) continue;
    if (DROPPED_PREFIXES.some((p) => key.startsWith(p))) continue;
    if (v === "[redacted]") continue;
    out[key] = v;
  }
  return out;
}

// ─── Ingestion ────────────────────────────────────────────────────────────────

export interface IngestInput {
  endpoint: Pick<WebhookEndpoint, "id" | "token" | "signatureScheme" | "secret">;
  method: string;
  headers: Headers;
  query: Record<string, string>;
  rawBody: string;
  sourceIp: string | null;
}

export async function ingestWebhook(input: IngestInput): Promise<WebhookEvent> {
  const { endpoint, method, headers, query, rawBody, sourceIp } = input;
  const contentType = headers.get("content-type");

  let jsonBody: Prisma.InputJsonValue | undefined;
  const looksJson = contentType?.includes("json") || /^\s*[[{]/.test(rawBody);
  if (looksJson && rawBody) {
    try {
      jsonBody = JSON.parse(rawBody) as Prisma.InputJsonValue;
    } catch {
      jsonBody = undefined;
    }
  }

  const signatureStatus = verifySignature(endpoint.signatureScheme, endpoint.secret, headers, rawBody);

  const event = await db.webhookEvent.create({
    data: {
      endpointId: endpoint.id,
      method: method.toUpperCase(),
      path: `/api/ingest/${endpoint.token}`,
      headers: sanitizeHeaders(headers),
      query,
      sourceIp,
      contentType,
      sizeBytes: Buffer.byteLength(rawBody, "utf8"),
      rawBody,
      jsonBody: jsonBody ?? Prisma.DbNull,
      eventType: detectEventType(headers, jsonBody ?? null),
      signatureStatus,
    },
  });

  return event;
}

/**
 * Bulk retention pruning: delete webhook events beyond `retentionPerEndpoint`
 * across all endpoints in a single windowed batch query.
 */
export async function pruneAllWebhookEvents(retentionPerEndpoint = EVENTS_RETAINED_PER_ENDPOINT): Promise<number> {
  const result = await db.$executeRaw`
    WITH ranked AS (
      SELECT id,
        ROW_NUMBER() OVER (PARTITION BY "endpointId" ORDER BY "receivedAt" DESC) as rn
      FROM "WebhookEvent"
    )
    DELETE FROM "WebhookEvent"
    WHERE id IN (
      SELECT id FROM ranked WHERE rn > ${retentionPerEndpoint}
    )
  `;
  return Number(result);
}

export async function pruneEvents(endpointId: string, keep = EVENTS_RETAINED_PER_ENDPOINT): Promise<number> {
  const cutoff = await db.webhookEvent.findMany({
    where: { endpointId },
    orderBy: { receivedAt: "desc" },
    skip: keep,
    take: 1,
    select: { receivedAt: true },
  });
  if (!cutoff[0]) return 0;
  const { count } = await db.webhookEvent.deleteMany({
    where: { endpointId, receivedAt: { lte: cutoff[0].receivedAt } },
  });
  return count;
}

// ─── Serialisation ────────────────────────────────────────────────────────────

export function serializeEndpoint(
  ep: WebhookEndpoint,
  extra: { eventCount?: number; lastEventAt?: Date | null; revealSecret?: boolean } = {},
) {
  return {
    id: ep.id,
    name: ep.name,
    token: ep.token,
    ingestPath: `/api/ingest/${ep.token}`,
    signatureScheme: ep.signatureScheme,
    hasSecret: Boolean(ep.secret),
    secretPreview: maskSecret(ep.secret),
    ...(extra.revealSecret && ep.secret ? { secret: ep.secret } : {}),
    eventCount: extra.eventCount ?? null,
    lastEventAt: extra.lastEventAt?.toISOString() ?? null,
    createdAt: ep.createdAt.toISOString(),
  };
}

export type SerializedEndpoint = ReturnType<typeof serializeEndpoint>;

/** Compact row for the live stream list. */
export const eventSummarySelect = {
  id: true,
  endpointId: true,
  method: true,
  eventType: true,
  contentType: true,
  sizeBytes: true,
  sourceIp: true,
  signatureStatus: true,
  receivedAt: true,
  _count: { select: { replays: true } },
} satisfies Prisma.WebhookEventSelect;

export type EventSummary = Prisma.WebhookEventGetPayload<{ select: typeof eventSummarySelect }>;
