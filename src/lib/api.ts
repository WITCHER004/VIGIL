import "server-only";
import { Prisma } from "@prisma/client";
import { ZodError, type ZodType, type ZodTypeDef } from "zod";
import { consumeToken, rateLimitHeaders, type BucketConfig } from "./rate-limit";
import { SsrfError } from "./ssrf";

/**
 * Shared Route Handler plumbing: typed errors, JSON helpers, body parsing,
 * client identification and per-IP throttling for expensive operations.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const NO_STORE = { "Cache-Control": "no-store" };

export function json<T>(data: T, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", NO_STORE["Cache-Control"]);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof ApiError) {
    return json({ error: { code: err.code, message: err.message, details: err.details } }, {
      status: err.status,
      headers: err.headers,
    });
  }
  if (err instanceof ZodError) {
    return json(
      {
        error: {
          code: "VALIDATION_FAILED",
          message: "Request did not pass validation.",
          details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      },
      { status: 400 },
    );
  }
  if (err instanceof SsrfError) {
    return json({ error: { code: `SSRF_${err.code}`, message: err.message } }, { status: 422 });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2025") return json({ error: { code: "NOT_FOUND", message: "Resource not found." } }, { status: 404 });
    if (err.code === "P2002") return json({ error: { code: "CONFLICT", message: "Resource already exists." } }, { status: 409 });
  }
  console.error("[api] unhandled error:", err);
  return json({ error: { code: "INTERNAL", message: "Something went wrong." } }, { status: 500 });
}

/** Wrap a Route Handler so every thrown error becomes a consistent JSON response. */
export function handler<C>(fn: (req: Request, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx: C): Promise<Response> => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export const notFound = (what = "Resource") => new ApiError(404, "NOT_FOUND", `${what} not found.`);

const MAX_JSON_BYTES = 256 * 1024;

/** Parse and validate a JSON request body. Empty bodies validate as `{}`. */
export async function readJson<Out, In = Out>(req: Request, schema: ZodType<Out, ZodTypeDef, In>): Promise<Out> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_JSON_BYTES) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Request body exceeds 256 KB.");
  const text = await req.text();
  if (text.length > MAX_JSON_BYTES) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Request body exceeds 256 KB.");
  let data: unknown = {};
  if (text.trim()) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new ApiError(400, "INVALID_JSON", "Request body is not valid JSON.");
    }
  }
  return schema.parse(data);
}

/** Validate URL search params against a schema. */
export function readQuery<Out, In = Out>(req: Request, schema: ZodType<Out, ZodTypeDef, In>): Out {
  return schema.parse(Object.fromEntries(new URL(req.url).searchParams));
}

/** Best-effort client IP (Vercel sets x-forwarded-for; first hop is the client). */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Per-IP throttle for expensive actions (probes, replays). Throws 429 when exhausted. */
export async function throttle(req: Request, action: string, cfg: BucketConfig): Promise<void> {
  const rl = await consumeToken(`${action}:${clientIp(req)}`, cfg);
  if (!rl.success) {
    throw new ApiError(
      429,
      "RATE_LIMITED",
      `Too many ${action} requests. Retry in ${rl.retryAfterSec}s.`,
      { retryAfterSec: rl.retryAfterSec },
      rateLimitHeaders(rl),
    );
  }
}

/** Throttle presets for operator actions. */
export const THROTTLE = {
  probe: { capacity: 20, refillPerSec: 0.5 },
  sweep: { capacity: 30, refillPerSec: 0.5 },
  replay: { capacity: 10, refillPerSec: 0.2 },
  mutate: { capacity: 40, refillPerSec: 1 },
  simulator: { capacity: 30, refillPerSec: 1 },
} as const satisfies Record<string, BucketConfig>;
