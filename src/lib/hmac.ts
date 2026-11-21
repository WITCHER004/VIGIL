import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * HMAC-SHA256 webhook signatures for the providers Vigil understands.
 * Deliberately free of `server-only` so `prisma/seed.ts` can sign sample events.
 *
 *   STRIPE    Stripe-Signature:      t=<unix>,v1=<hex hmac of "<t>.<body>">
 *   GITHUB    X-Hub-Signature-256:   sha256=<hex hmac of body>
 *   RAZORPAY  X-Razorpay-Signature:  <hex hmac of body>
 *   GENERIC   X-Vigil-Signature:     sha256=<hex hmac of body>
 */

export type Scheme = "NONE" | "STRIPE" | "GITHUB" | "RAZORPAY" | "GENERIC";
export type VerifyResult = "UNCHECKED" | "VALID" | "INVALID" | "MISSING";

export const SIGNATURE_HEADER: Record<Exclude<Scheme, "NONE">, string> = {
  STRIPE: "stripe-signature",
  GITHUB: "x-hub-signature-256",
  RAZORPAY: "x-razorpay-signature",
  GENERIC: "x-vigil-signature",
};

/** Stripe's default replay-protection window. */
export const STRIPE_TOLERANCE_SEC = 300;

export function hmacHex(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data, "utf8").digest("hex");
}

/** Constant-time comparison of two hex digests. */
export function safeEqualHex(a: string, b: string): boolean {
  if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b) || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

/** Produce the signature header(s) a provider would send for `body`. */
export function signPayload(
  scheme: Scheme,
  secret: string,
  body: string,
  timestampSec: number = Math.floor(Date.now() / 1000),
): Record<string, string> {
  switch (scheme) {
    case "NONE":
      return {};
    case "STRIPE":
      return { [SIGNATURE_HEADER.STRIPE]: `t=${timestampSec},v1=${hmacHex(secret, `${timestampSec}.${body}`)}` };
    case "GITHUB":
      return { [SIGNATURE_HEADER.GITHUB]: `sha256=${hmacHex(secret, body)}` };
    case "RAZORPAY":
      return { [SIGNATURE_HEADER.RAZORPAY]: hmacHex(secret, body) };
    case "GENERIC":
      return { [SIGNATURE_HEADER.GENERIC]: `sha256=${hmacHex(secret, body)}` };
  }
}

type HeaderSource = Headers | Record<string, string | undefined>;

function readHeader(headers: HeaderSource, name: string): string | undefined {
  if (typeof (headers as Headers).get === "function") return (headers as Headers).get(name) ?? undefined;
  const rec = headers as Record<string, string | undefined>;
  const key = Object.keys(rec).find((k) => k.toLowerCase() === name);
  return key ? rec[key] : undefined;
}

/**
 * Verify an incoming request's signature against the raw body.
 * The body must be the exact bytes received — never a re-serialised JSON object.
 */
export function verifySignature(
  scheme: Scheme,
  secret: string | null | undefined,
  headers: HeaderSource,
  rawBody: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): VerifyResult {
  if (scheme === "NONE" || !secret) return "UNCHECKED";
  const header = readHeader(headers, SIGNATURE_HEADER[scheme])?.trim();
  if (!header) return "MISSING";

  switch (scheme) {
    case "STRIPE": {
      const parts = new Map<string, string[]>();
      for (const kv of header.split(",")) {
        const [k, ...rest] = kv.trim().split("=");
        if (!k || rest.length === 0) continue;
        parts.set(k, [...(parts.get(k) ?? []), rest.join("=")]);
      }
      const t = Number(parts.get("t")?.[0]);
      const sigs = parts.get("v1") ?? [];
      if (!Number.isFinite(t) || sigs.length === 0) return "INVALID";
      if (Math.abs(nowSec - t) > STRIPE_TOLERANCE_SEC) return "INVALID";
      const expected = hmacHex(secret, `${t}.${rawBody}`);
      return sigs.some((s) => safeEqualHex(s, expected)) ? "VALID" : "INVALID";
    }
    case "GITHUB":
    case "GENERIC": {
      const sig = header.startsWith("sha256=") ? header.slice(7) : "";
      return safeEqualHex(sig, hmacHex(secret, rawBody)) ? "VALID" : "INVALID";
    }
    case "RAZORPAY":
      return safeEqualHex(header, hmacHex(secret, rawBody)) ? "VALID" : "INVALID";
  }
}
