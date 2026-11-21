import { describe, expect, it } from "vitest";
import { isInternalSimUrl, isRelativeSimPath, parseTarget, SsrfError } from "../ssrf";
import { ALLOWED_SIM_SERVICES, ALLOWED_SIM_TARGETS, targetUrl } from "../validation";

describe("SSRF Protection & Target Validation", () => {
  const appOrigin = "http://localhost:3000";

  it("blocks dangerous schemes", () => {
    expect(() => parseTarget("file:///etc/passwd", appOrigin)).toThrow(SsrfError);
    expect(() => parseTarget("ftp://ftp.example.com", appOrigin)).toThrow(SsrfError);
    expect(() => parseTarget("gopher://127.0.0.1", appOrigin)).toThrow(SsrfError);
  });

  it("blocks embedded credentials", () => {
    expect(() => parseTarget("https://user:password@example.com", appOrigin)).toThrow(SsrfError);
  });

  it("blocks unapproved ports", () => {
    expect(() => parseTarget("http://example.com:22", appOrigin)).toThrow(SsrfError);
    expect(() => parseTarget("https://example.com:3306", appOrigin)).toThrow(SsrfError);
    expect(() => parseTarget("http://example.com:25", appOrigin)).toThrow(SsrfError);
  });

  it("blocks loopback and localhost hostnames", () => {
    expect(() => parseTarget("http://localhost", appOrigin)).toThrow(SsrfError);
    expect(() => parseTarget("http://localhost:8080", appOrigin)).toThrow(SsrfError);
    expect(() => parseTarget("http://sub.localhost", appOrigin)).toThrow(SsrfError);
  });

  it("blocks direct loopback IP literals", () => {
    expect(() => parseTarget("http://127.0.0.1", appOrigin)).toThrow(SsrfError);
    expect(() => parseTarget("http://127.0.0.2", appOrigin)).toThrow(SsrfError);
    expect(() => parseTarget("http://[::1]", appOrigin)).toThrow(SsrfError);
  });

  it("blocks RFC1918 private IPv4 addresses", () => {
    expect(() => parseTarget("http://10.0.0.1", appOrigin)).toThrow(SsrfError);
    expect(() => parseTarget("http://172.16.0.1", appOrigin)).toThrow(SsrfError);
    expect(() => parseTarget("http://192.168.1.1", appOrigin)).toThrow(SsrfError);
  });

  it("blocks cloud metadata service IP literals and hostnames", () => {
    expect(() => parseTarget("http://169.254.169.254/latest/meta-data", appOrigin)).toThrow(SsrfError);
    expect(() => parseTarget("http://metadata.google.internal", appOrigin)).toThrow(SsrfError);
    expect(() => parseTarget("http://instance-data.ec2.internal", appOrigin)).toThrow(SsrfError);
  });

  it("permits valid external public URLs", () => {
    const res = parseTarget("https://api.github.com/status", appOrigin);
    expect(res.internal).toBe(false);
    expect(res.url.hostname).toBe("api.github.com");
  });

  describe("Internal Simulated Chaos Targets Allowlist", () => {
    it("allows valid simulated services via relative paths", () => {
      for (const svc of ALLOWED_SIM_SERVICES) {
        const path = `/api/sim/${svc}`;
        expect(isRelativeSimPath(path)).toBe(true);
        const parsed = parseTarget(path, appOrigin);
        expect(parsed.internal).toBe(true);
        expect(parsed.url.pathname).toBe(path);
      }
    });

    it("explicitly rejects /api/sim/recover from being probed", () => {
      expect(isRelativeSimPath("/api/sim/recover")).toBe(false);
      // Attempting to probe /api/sim/recover should NOT be recognized as internal sim target
      expect(() => parseTarget("/api/sim/recover", appOrigin)).toThrow(SsrfError);

      const recoverUrl = new URL("/api/sim/recover", appOrigin);
      expect(isInternalSimUrl(recoverUrl, appOrigin)).toBe(false);
    });

    it("explicitly rejects path traversal under /api/sim/", () => {
      expect(isRelativeSimPath("/api/sim/../cron/probe")).toBe(false);
      expect(isRelativeSimPath("/api/sim/unknown-service")).toBe(false);
    });

    it("enforces targetUrl validation schema on monitor creation", () => {
      // Valid allowed simulated targets pass validation
      for (const target of ALLOWED_SIM_TARGETS) {
        expect(targetUrl.safeParse(target).success).toBe(true);
      }
      expect(targetUrl.safeParse("https://example.com/api/health").success).toBe(true);

      // /api/sim/recover must fail validation
      const recoverRes = targetUrl.safeParse("/api/sim/recover");
      expect(recoverRes.success).toBe(false);

      // Unknown simulated targets must fail validation
      const unknownRes = targetUrl.safeParse("/api/sim/random-endpoint");
      expect(unknownRes.success).toBe(false);
    });
  });
});
