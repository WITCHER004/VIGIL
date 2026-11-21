import { describe, expect, it } from "vitest";
import { signPayload, verifySignature } from "../hmac";
import { detectEventType } from "../sample-payloads";
import { maskSecret, sanitizeHeaders } from "../webhooks";

describe("Webhook Signature Verification & HMAC", () => {
  const secret = "whsec_test_secret_key_1234567890";
  const payload = JSON.stringify({ event: "charge.successful", amount: 4200 });

  it("verifies NONE scheme as UNCHECKED unconditionally", () => {
    const headers = new Headers();
    expect(verifySignature("NONE", null, headers, payload)).toBe("UNCHECKED");
    expect(verifySignature("NONE", secret, headers, payload)).toBe("UNCHECKED");
  });

  it("verifies STRIPE signatures correctly with timestamp tolerance", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const headers = new Headers(signPayload("STRIPE", secret, payload, nowSec));

    expect(verifySignature("STRIPE", secret, headers, payload, nowSec)).toBe("VALID");

    // Tampered payload fails
    const tamperedPayload = JSON.stringify({ event: "charge.successful", amount: 999999 });
    expect(verifySignature("STRIPE", secret, headers, tamperedPayload, nowSec)).toBe("INVALID");

    // Missing header fails
    expect(verifySignature("STRIPE", secret, new Headers(), payload, nowSec)).toBe("MISSING");

    // Expired timestamp fails
    const oldTimestamp = nowSec - 600;
    const oldHeaders = new Headers(signPayload("STRIPE", secret, payload, oldTimestamp));
    expect(verifySignature("STRIPE", secret, oldHeaders, payload, nowSec)).toBe("INVALID");
  });

  it("verifies GITHUB signatures correctly", () => {
    const headers = new Headers(signPayload("GITHUB", secret, payload));

    expect(verifySignature("GITHUB", secret, headers, payload)).toBe("VALID");

    // Tampered payload
    expect(verifySignature("GITHUB", secret, headers, payload + "tamper")).toBe("INVALID");

    // Missing header
    expect(verifySignature("GITHUB", secret, new Headers(), payload)).toBe("MISSING");
  });

  it("verifies RAZORPAY signatures correctly", () => {
    const headers = new Headers(signPayload("RAZORPAY", secret, payload));

    expect(verifySignature("RAZORPAY", secret, headers, payload)).toBe("VALID");

    // Tampered payload
    expect(verifySignature("RAZORPAY", secret, headers, payload + "tamper")).toBe("INVALID");

    // Missing header
    expect(verifySignature("RAZORPAY", secret, new Headers(), payload)).toBe("MISSING");
  });

  it("verifies GENERIC signatures correctly", () => {
    const headers = new Headers(signPayload("GENERIC", secret, payload));

    expect(verifySignature("GENERIC", secret, headers, payload)).toBe("VALID");

    // Tampered payload
    expect(verifySignature("GENERIC", secret, headers, payload + "tamper")).toBe("INVALID");

    // Missing header
    expect(verifySignature("GENERIC", secret, new Headers(), payload)).toBe("MISSING");
  });

  it("returns UNCHECKED when scheme requires a secret but secret is null", () => {
    const headers = new Headers({ "stripe-signature": "some_sig" });
    expect(verifySignature("STRIPE", null, headers, payload)).toBe("UNCHECKED");
  });
});

describe("Webhook Utilities & Sanitization", () => {
  it("masks secrets securely", () => {
    expect(maskSecret(null)).toBeNull();
    expect(maskSecret("short")).toBe("••••••");
    expect(maskSecret("whsec_1234567890abcdef")).toBe("whsec_••••cdef");
  });

  it("sanitizes sensitive headers", () => {
    const headers = new Headers({
      authorization: "Bearer secret-token",
      cookie: "session=12345",
      "x-custom-header": "safe-value",
      "content-type": "application/json",
    });

    const sanitized = sanitizeHeaders(headers);
    expect(sanitized.authorization).toBe("[redacted]");
    expect(sanitized.cookie).toBe("[redacted]");
    expect(sanitized["x-custom-header"]).toBe("safe-value");
    expect(sanitized["content-type"]).toBe("application/json");
  });

  it("detects event types accurately", () => {
    const githubHeaders = new Headers({ "x-github-event": "push" });
    expect(detectEventType(githubHeaders, null)).toBe("push");

    const stripeBody = { type: "payment_intent.succeeded" };
    expect(detectEventType(new Headers(), stripeBody)).toBe("payment_intent.succeeded");

    const genericBody = { event: "user.created" };
    expect(detectEventType(new Headers(), genericBody)).toBe("user.created");

    expect(detectEventType(new Headers(), null)).toBeNull();
  });
});
