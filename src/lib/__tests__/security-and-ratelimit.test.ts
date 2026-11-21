import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractClientIp } from "../api";
import {
  createOperatorSession,
  OPERATOR_COOKIE_NAME,
  safeCompare,
  verifyOperatorAuth,
  verifyOperatorSession,
} from "../auth";
import { __testing, MAX_MEMORY_BUCKETS, type BucketConfig } from "../rate-limit";

describe("Client IP Extraction (Anti-Spoofing)", () => {
  it("prioritizes platform-overwritten headers over x-forwarded-for", () => {
    const headers = new Headers({
      "x-forwarded-for": "198.51.100.1, 198.51.100.2",
      "cf-connecting-ip": "203.0.113.50",
      "x-real-ip": "203.0.113.60",
    });
    // cf-connecting-ip takes precedence over x-real-ip and x-forwarded-for
    expect(extractClientIp(headers)).toBe("203.0.113.50");
  });

  it("prioritizes x-vercel-forwarded-for when present", () => {
    const headers = new Headers({
      "x-vercel-forwarded-for": "203.0.113.10",
      "cf-connecting-ip": "203.0.113.20",
      "x-forwarded-for": "1.1.1.1, 2.2.2.2",
    });
    expect(extractClientIp(headers)).toBe("203.0.113.10");
  });

  it("selects the RIGHTMOST IP from x-forwarded-for (trusted proxy hop)", () => {
    const headers = new Headers({
      "x-forwarded-for": "spoofed.client.ip, 10.0.0.1, 198.51.100.99",
    });
    // Must select 198.51.100.99 (the hop appended by the edge proxy), NOT spoofed.client.ip
    expect(extractClientIp(headers)).toBe("198.51.100.99");
  });

  it("normalizes IPv6-mapped IPv4 addresses", () => {
    const headers = new Headers({
      "x-real-ip": "::ffff:192.0.2.128",
    });
    expect(extractClientIp(headers)).toBe("192.0.2.128");

    const xffHeaders = new Headers({
      "x-forwarded-for": "::ffff:203.0.113.4",
    });
    expect(extractClientIp(xffHeaders)).toBe("203.0.113.4");
  });

  it("returns 'unknown' when no client IP headers exist or only empty whitespace", () => {
    expect(extractClientIp(new Headers())).toBe("unknown");
    expect(extractClientIp(new Headers({ "x-forwarded-for": " ,  , " }))).toBe("unknown");
  });
});

describe("Operator Authentication & Session Security", () => {
  const secret = "super-secret-operator-key-32-bytes-long";

  it("performs constant-time safe comparison", () => {
    expect(safeCompare("same-string", "same-string")).toBe(true);
    expect(safeCompare("string-a", "string-b")).toBe(false);
    expect(safeCompare("short", "longer-string")).toBe(false);
  });

  it("creates and verifies signed operator sessions", () => {
    const sessionToken = createOperatorSession(secret, 3600);
    expect(verifyOperatorSession(sessionToken, secret)).toBe(true);

    // Tampered payload fails
    const [payload, sig] = sessionToken.split(".");
    const tamperedPayload = Buffer.from(JSON.stringify({ role: "admin", exp: 9999999999 })).toString("base64url");
    expect(verifyOperatorSession(`${tamperedPayload}.${sig}`, secret)).toBe(false);

    // Tampered signature fails
    expect(verifyOperatorSession(`${payload}.invalidsig`, secret)).toBe(false);

    // Expired session fails
    const expiredToken = createOperatorSession(secret, -100);
    expect(verifyOperatorSession(expiredToken, secret)).toBe(false);
  });

  describe("verifyOperatorAuth gatekeeper", () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it("fails closed in production if VIGIL_OPERATOR_SECRET is unset", async () => {
      (process.env as Record<string, string | undefined>).NODE_ENV = "production";
      delete process.env.VIGIL_OPERATOR_SECRET;

      const req = new Request("http://localhost/api/probe/sweep", { method: "POST" });
      await expect(verifyOperatorAuth(req)).rejects.toMatchObject({
        status: 503,
        code: "SERVICE_UNAVAILABLE",
      });
    });

    it("enforces valid credentials in production", async () => {
      (process.env as Record<string, string | undefined>).NODE_ENV = "production";
      process.env.VIGIL_OPERATOR_SECRET = secret;

      // Unauthorized request (no headers/cookies) -> 401
      const unauthReq = new Request("http://localhost/api/probe/sweep", { method: "POST" });
      await expect(verifyOperatorAuth(unauthReq)).rejects.toMatchObject({
        status: 401,
        code: "UNAUTHORIZED",
      });

      // Valid Bearer token -> success
      const bearerReq = new Request("http://localhost/api/probe/sweep", {
        method: "POST",
        headers: { authorization: `Bearer ${secret}` },
      });
      await expect(verifyOperatorAuth(bearerReq)).resolves.toEqual({ authorized: true });

      // Valid x-operator-secret header -> success
      const headerReq = new Request("http://localhost/api/probe/sweep", {
        method: "POST",
        headers: { "x-operator-secret": secret },
      });
      await expect(verifyOperatorAuth(headerReq)).resolves.toEqual({ authorized: true });

      // Valid session cookie -> success
      const session = createOperatorSession(secret, 3600);
      const cookieReq = new Request("http://localhost/api/probe/sweep", {
        method: "POST",
        headers: { cookie: `${OPERATOR_COOKIE_NAME}=${session}` },
      });
      await expect(verifyOperatorAuth(cookieReq)).resolves.toEqual({ authorized: true });
    });

    it("allows smooth zero-config developer access when secret is unset in non-production", async () => {
      (process.env as Record<string, string | undefined>).NODE_ENV = "development";
      delete process.env.VIGIL_OPERATOR_SECRET;

      const req = new Request("http://localhost/api/probe/sweep", { method: "POST" });
      await expect(verifyOperatorAuth(req)).resolves.toEqual({ authorized: true });
    });
  });
});

describe("In-Memory Rate Limiter & Two-Pass Bucket Eviction", () => {
  const cfg: BucketConfig = { capacity: 5, refillPerSec: 1 };

  beforeEach(() => {
    __testing.buckets.clear();
  });

  it("consumes tokens and denies requests when capacity is exhausted", () => {
    const key = "test:user:1";
    const now = 1_000_000;

    // First 5 requests succeed
    for (let i = 0; i < 5; i++) {
      const res = __testing.consumeMemory(key, cfg, 1, now);
      expect(res.success).toBe(true);
      expect(res.remaining).toBe(4 - i);
    }

    // 6th request is rejected
    const blocked = __testing.consumeMemory(key, cfg, 1, now);
    expect(blocked.success).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSec).toBe(1);

    // Refill after 2 seconds
    const refilled = __testing.consumeMemory(key, cfg, 1, now + 2000);
    expect(refilled.success).toBe(true);
  });

  it("evicts refilled buckets in Pass 1 when capacity threshold is reached", () => {
    const now = 1_000_000;

    // Fill map with MAX_MEMORY_BUCKETS items
    for (let i = 0; i < MAX_MEMORY_BUCKETS; i++) {
      __testing.buckets.set(`key:${i}`, {
        tokens: 0,
        ts: now,
        capacity: 5,
        refillPerSec: 1,
      });
    }

    // Mark half the buckets as having elapsed sufficient time to completely refill (5s)
    let count = 0;
    for (const [k, b] of __testing.buckets.entries()) {
      if (count++ % 2 === 0) {
        b.ts = now - 10_000; // 10s ago -> fully refilled
      }
    }

    expect(__testing.buckets.size).toBe(MAX_MEMORY_BUCKETS);

    // Adding one new entry triggers Pass 1 eviction
    __testing.consumeMemory("new-key", cfg, 1, now);

    // Half of the buckets were fully refilled and should have been evicted in Pass 1
    expect(__testing.buckets.size).toBeLessThan(MAX_MEMORY_BUCKETS);
    expect(__testing.buckets.has("new-key")).toBe(true);
  });
});
