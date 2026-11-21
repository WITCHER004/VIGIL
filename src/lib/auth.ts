import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { ApiError } from "./api";

export const OPERATOR_COOKIE_NAME = "vigil_operator_session";

/** Constant-time string comparison preventing timing attacks. */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/** Create an HMAC-SHA256 signed session token for operator authentication. */
export function createOperatorSession(secret: string, maxAgeSec = 7 * 86_400): string {
  const exp = Math.floor(Date.now() / 1000) + maxAgeSec;
  const payload = Buffer.from(JSON.stringify({ role: "operator", exp })).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

/** Verify an HMAC-SHA256 signed operator session token. */
export function verifyOperatorSession(token: string, secret: string): boolean {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;

  const expectedSig = createHmac("sha256", secret).update(payload).digest("base64url");
  if (!safeCompare(sig, expectedSig)) return false;

  try {
    const raw = Buffer.from(payload, "base64url").toString("utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.role !== "operator" || typeof parsed.exp !== "number") {
      return false;
    }
    const nowSec = Math.floor(Date.now() / 1000);
    return parsed.exp > nowSec;
  } catch {
    return false;
  }
}

/** Parse Cookie header into key-value pairs. */
export function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {};
  const cookies: Record<string, string> = {};
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k) cookies[k] = decodeURIComponent(v.join("="));
  }
  return cookies;
}

/**
 * Validates operator authentication for protected API routes (e.g. POST /api/probe/sweep).
 * In production (NODE_ENV === "production"):
 *   - If VIGIL_OPERATOR_SECRET is unset, fail closed with 503 (service unavailable).
 *   - Checks Bearer token, x-operator-secret header, or signed vigil_operator_session cookie.
 * In development / test:
 *   - If VIGIL_OPERATOR_SECRET is set, enforces credentials.
 *   - If VIGIL_OPERATOR_SECRET is unset, smoothly permits local developer requests.
 */
export async function verifyOperatorAuth(req: Request): Promise<{ authorized: true }> {
  const secret = process.env.VIGIL_OPERATOR_SECRET;
  const isProd = process.env.NODE_ENV === "production";

  if (isProd && !secret) {
    throw new ApiError(503, "SERVICE_UNAVAILABLE", "Operator secret (VIGIL_OPERATOR_SECRET) is not configured.");
  }

  if (!secret) {
    // Local development zero-config bypass when no secret is defined
    return { authorized: true };
  }

  // 1. Check Bearer token in Authorization header
  const authHeader = req.headers.get("authorization");
  if (authHeader?.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7).trim();
    if (safeCompare(token, secret)) {
      return { authorized: true };
    }
  }

  // 2. Check x-operator-secret header
  const headerSecret = req.headers.get("x-operator-secret");
  if (headerSecret && safeCompare(headerSecret, secret)) {
    return { authorized: true };
  }

  // 3. Check vigil_operator_session cookie
  const cookies = parseCookies(req.headers.get("cookie"));
  const sessionToken = cookies[OPERATOR_COOKIE_NAME];
  if (sessionToken && verifyOperatorSession(sessionToken, secret)) {
    return { authorized: true };
  }

  throw new ApiError(401, "UNAUTHORIZED", "Operator authentication required.");
}
