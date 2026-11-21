import "server-only";
import { Redis } from "@upstash/redis";

/**
 * Token-bucket rate limiter.
 *
 * - **Upstash Redis** (when `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are set):
 *   refill + consume run inside a single Lua script, so concurrent requests across every
 *   serverless instance see one atomic bucket.
 * - **In-memory fallback** for zero-config local dev. Per-instance only; also used as a
 *   fail-open safety net if Redis is unreachable, so ingestion never hard-fails on infra.
 *
 * A bucket holds up to `capacity` tokens and refills continuously at `refillPerSec`.
 * Each request consumes `cost` tokens (default 1).
 */

export interface BucketConfig {
  /** Maximum burst size. */
  capacity: number;
  /** Tokens added per second. */
  refillPerSec: number;
}

export interface RateLimitResult {
  success: boolean;
  limit: number;
  /** Whole tokens left after this request. */
  remaining: number;
  /** Seconds until the bucket is completely full again. */
  resetSec: number;
  /** Seconds the caller should wait before retrying (0 when allowed). */
  retryAfterSec: number;
  backend: "upstash" | "memory";
}

export const INGEST_BUCKET: BucketConfig = {
  capacity: positiveNumber(process.env.INGEST_BUCKET_CAPACITY, 30),
  refillPerSec: positiveNumber(process.env.INGEST_BUCKET_REFILL_PER_SEC, 0.5),
};

function positiveNumber(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// ─── Shared maths ─────────────────────────────────────────────────────────────

function buildResult(
  allowed: boolean,
  tokens: number,
  cfg: BucketConfig,
  cost: number,
  backend: RateLimitResult["backend"],
): RateLimitResult {
  const deficit = Math.max(0, cost - tokens);
  return {
    success: allowed,
    limit: cfg.capacity,
    remaining: Math.max(0, Math.floor(tokens)),
    resetSec: Math.ceil((cfg.capacity - tokens) / cfg.refillPerSec),
    retryAfterSec: allowed ? 0 : Math.max(1, Math.ceil(deficit / cfg.refillPerSec)),
    backend,
  };
}

// ─── Upstash backend ──────────────────────────────────────────────────────────

/**
 * KEYS[1] = bucket key
 * ARGV    = capacity, refillPerSec, nowMs, cost
 * Returns { allowed (0|1), tokens (string, to preserve fractional precision) }
 */
const TOKEN_BUCKET_LUA = `
local key      = KEYS[1]
local capacity = tonumber(ARGV[1])
local rate     = tonumber(ARGV[2])
local now      = tonumber(ARGV[3])
local cost     = tonumber(ARGV[4])

local state  = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(state[1])
local ts     = tonumber(state[2])
if tokens == nil or ts == nil then
  tokens = capacity
  ts = now
end

local elapsed = math.max(0, now - ts) / 1000
tokens = math.min(capacity, tokens + elapsed * rate)

local allowed = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
end

redis.call('HSET', key, 'tokens', tostring(tokens), 'ts', tostring(now))
redis.call('PEXPIRE', key, math.ceil((capacity / rate) * 1000) + 60000)
return { allowed, tostring(tokens) }
`;

let redis: Redis | null | undefined;
function getRedis(): Redis | null {
  if (redis !== undefined) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  redis = url && token ? new Redis({ url, token }) : null;
  return redis;
}

async function consumeUpstash(client: Redis, key: string, cfg: BucketConfig, cost: number): Promise<RateLimitResult> {
  const [allowed, tokens] = await client.eval<[string, string, string, string], [number, string]>(
    TOKEN_BUCKET_LUA,
    [key],
    [String(cfg.capacity), String(cfg.refillPerSec), String(Date.now()), String(cost)],
  );
  return buildResult(Number(allowed) === 1, Number(tokens), cfg, cost, "upstash");
}

// ─── In-memory backend ────────────────────────────────────────────────────────

export interface MemoryBucket {
  tokens: number;
  ts: number;
  capacity: number;
  refillPerSec: number;
}

const globalForBuckets = globalThis as unknown as { __vigilBuckets?: Map<string, MemoryBucket> };
const buckets = (globalForBuckets.__vigilBuckets ??= new Map<string, MemoryBucket>());
export const MAX_MEMORY_BUCKETS = 10_000;

function consumeMemory(key: string, cfg: BucketConfig, cost: number, now = Date.now()): RateLimitResult {
  const prev = buckets.get(key);
  let tokens = prev
    ? Math.min(cfg.capacity, prev.tokens + (Math.max(0, now - prev.ts) / 1000) * cfg.refillPerSec)
    : cfg.capacity;

  const allowed = tokens >= cost;
  if (allowed) tokens -= cost;

  // Map preserves insertion order: delete + set moves the key to the "most recent" end.
  buckets.delete(key);
  buckets.set(key, { tokens, ts: now, capacity: cfg.capacity, refillPerSec: cfg.refillPerSec });

  if (buckets.size >= MAX_MEMORY_BUCKETS) {
    // Pass 1: Evict buckets that have completely refilled to full capacity
    for (const [k, b] of buckets.entries()) {
      const timeToFullMs = ((b.capacity - b.tokens) / b.refillPerSec) * 1000;
      if (now - b.ts >= timeToFullMs) {
        buckets.delete(k);
      }
    }

    // Pass 2: If still at or over threshold, evict oldest buckets (least-recently-used)
    if (buckets.size >= MAX_MEMORY_BUCKETS) {
      const overflow = buckets.size - MAX_MEMORY_BUCKETS + 1;
      let count = 0;
      for (const k of buckets.keys()) {
        buckets.delete(k);
        count++;
        if (count >= overflow) break;
      }
    }
  }

  return buildResult(allowed, tokens, cfg, cost, "memory");
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Atomically refill and consume from the bucket identified by `identifier`.
 * @example const rl = await consumeToken(`ingest:${token}`, INGEST_BUCKET);
 */
export async function consumeToken(
  identifier: string,
  cfg: BucketConfig = INGEST_BUCKET,
  cost = 1,
): Promise<RateLimitResult> {
  const key = `vigil:rl:${identifier}`;
  const client = getRedis();
  if (client) {
    try {
      return await consumeUpstash(client, key, cfg, cost);
    } catch (err) {
      console.error("[rate-limit] Upstash unavailable, falling back to in-memory bucket:", err);
    }
  }
  return consumeMemory(key, cfg, cost);
}

/** Non-consuming read of the bucket's current level (for the UI rate-limit meter). */
export async function peekBucket(identifier: string, cfg: BucketConfig = INGEST_BUCKET): Promise<RateLimitResult> {
  const key = `vigil:rl:${identifier}`;
  const client = getRedis();
  const now = Date.now();
  if (client) {
    try {
      // Upstash auto-deserialises numeric strings, so values may arrive as number or string.
      const state = await client.hmget<{ tokens: string | number | null; ts: string | number | null }>(
        key,
        "tokens",
        "ts",
      );
      const rawTokens = state?.tokens;
      const rawTs = state?.ts;
      const tokens =
        rawTokens == null || rawTs == null
          ? cfg.capacity
          : Math.min(cfg.capacity, Number(rawTokens) + ((now - Number(rawTs)) / 1000) * cfg.refillPerSec);
      return buildResult(true, tokens, cfg, 0, "upstash");
    } catch {
      /* fall through to memory */
    }
  }
  const prev = buckets.get(key);
  const tokens = prev
    ? Math.min(cfg.capacity, prev.tokens + ((now - prev.ts) / 1000) * cfg.refillPerSec)
    : cfg.capacity;
  return buildResult(true, tokens, cfg, 0, "memory");
}

/** Standard rate-limit response headers. */
export function rateLimitHeaders(r: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    "X-RateLimit-Limit": String(r.limit),
    "X-RateLimit-Remaining": String(r.remaining),
    "X-RateLimit-Reset": String(r.resetSec),
    "X-RateLimit-Backend": r.backend,
  };
  if (!r.success) headers["Retry-After"] = String(r.retryAfterSec);
  return headers;
}

/** Exposed for tests. */
export const __testing = { consumeMemory, buckets };
