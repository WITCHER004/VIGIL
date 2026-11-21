import { z } from "zod";
import { SAMPLE_PROVIDERS } from "./sample-payloads";
import { SIM_MODES } from "./sim";
import { TIME_RANGES } from "./stats";

/**
 * Zod schemas for every API boundary. Enum values are literal lists (not
 * Prisma's generated enums) so these schemas are importable from client
 * components for form validation without bundling @prisma/client.
 */

export const HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;
export const INCIDENT_STATUSES = ["INVESTIGATING", "IDENTIFIED", "RESOLVED"] as const;
export const SIGNATURE_SCHEMES = ["NONE", "STRIPE", "GITHUB", "RAZORPAY", "GENERIC"] as const;
export const REPLAY_METHODS = ["POST", "PUT", "PATCH"] as const;

const id = z.string().trim().min(1).max(64);
const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

export const ALLOWED_SIM_SERVICES = ["checkout-api", "auth-gateway", "ledger-sync"] as const;
export const ALLOWED_SIM_TARGETS = ALLOWED_SIM_SERVICES.map((s) => `/api/sim/${s}` as const);

/** Absolute http(s) URL or an allowed internal `/api/sim/<service>` demo path. Explicitly rejects /api/sim/recover. */
export const targetUrl = z
  .string()
  .trim()
  .min(1, "URL is required")
  .max(2048)
  .refine(
    (v) => {
      if (v.startsWith("/api/sim/")) {
        const service = v.slice("/api/sim/".length);
        return (ALLOWED_SIM_SERVICES as readonly string[]).includes(service);
      }
      return /^https?:\/\/[^\s]+$/i.test(v);
    },
    {
      message: `Use an absolute http(s) URL, or an allowed simulated target (${ALLOWED_SIM_TARGETS.join(", ")}).`,
    },
  );

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

// ─── Monitors ─────────────────────────────────────────────────────────────────

export const monitorCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  url: targetUrl,
  method: z.enum(HTTP_METHODS).default("GET"),
  expectedStatus: int(100, 599).default(200),
  timeoutMs: int(500, 30_000).default(10_000),
  intervalSec: int(30, 86_400).default(60),
  bodyContains: optionalText(500),
  degradedThresholdMs: int(25, 30_000).default(500),
  isPaused: z.boolean().default(false),
  showOnStatusPage: z.boolean().default(false),
});
export type MonitorCreateInput = z.input<typeof monitorCreateSchema>;

export const monitorUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    url: targetUrl,
    method: z.enum(HTTP_METHODS),
    expectedStatus: int(100, 599),
    timeoutMs: int(500, 30_000),
    intervalSec: int(30, 86_400),
    bodyContains: optionalText(500),
    degradedThresholdMs: int(25, 30_000),
    isPaused: z.boolean(),
    showOnStatusPage: z.boolean(),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, { message: "Provide at least one field to update." });
export type MonitorUpdateInput = z.input<typeof monitorUpdateSchema>;

export const rangeQuerySchema = z.object({
  range: z.enum(TIME_RANGES).default("24H"),
});

export const checksQuerySchema = z.object({
  cursor: id.optional(),
  limit: int(1, 200).default(50),
  status: z.enum(["all", "ok", "failed"]).default("all"),
});

export const sweepSchema = z.object({
  /** "due" = only monitors whose interval has elapsed (live polling); "all" = every active monitor. */
  scope: z.enum(["due", "all"]).default("due"),
});

// ─── Webhooks ─────────────────────────────────────────────────────────────────

export const endpointCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  signatureScheme: z.enum(SIGNATURE_SCHEMES).default("NONE"),
  /** Optional custom secret; one is generated when a scheme is chosen and this is omitted. */
  secret: z.string().trim().min(8).max(200).optional(),
});

export const endpointUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    signatureScheme: z.enum(SIGNATURE_SCHEMES),
    rotateSecret: z.literal(true),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, { message: "Provide at least one field to update." });

export const eventsQuerySchema = z.object({
  /** ISO timestamp — return only events received strictly after it (live stream polling). */
  after: z.string().datetime({ offset: true }).optional(),
  cursor: id.optional(),
  limit: int(1, 100).default(40),
});

const headerName = z.string().trim().min(1).max(100).regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/, "Invalid header name");

export const replaySchema = z.object({
  targetUrl,
  method: z.enum(REPLAY_METHODS).default("POST"),
  /** Edited raw body. Omit to replay the original bytes untouched. */
  body: z.string().max(512 * 1024).optional(),
  /** Header overrides merged over the forwarded originals. Empty string removes a header. */
  headers: z.record(headerName, z.string().max(4096)).default({}),
  /** Re-sign the (possibly edited) body with the endpoint's secret so signatures stay valid. */
  resign: z.boolean().default(false),
});

// ─── Incidents ────────────────────────────────────────────────────────────────

export const incidentsQuerySchema = z.object({
  status: z.enum(["active", "resolved", "all"]).default("all"),
  monitorId: id.optional(),
  limit: int(1, 100).default(50),
});

export const incidentUpdateSchema = z.object({
  status: z.enum(INCIDENT_STATUSES),
  message: z.string().trim().max(2000).optional(),
});

export const incidentNoteSchema = z.object({
  message: z.string().trim().min(1, "Note cannot be empty").max(2000),
  /** Optionally advance the incident status with this note. */
  status: z.enum(INCIDENT_STATUSES).optional(),
});

// ─── Simulator ────────────────────────────────────────────────────────────────

export const simulatorPatchSchema = z.object({
  service: z.string().trim().min(1).max(64),
  mode: z.enum(SIM_MODES),
});

export const simulatorWebhookSchema = z.object({
  provider: z.enum(SAMPLE_PROVIDERS),
  endpointId: id.optional(),
});
