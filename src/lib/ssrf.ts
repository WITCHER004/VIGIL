import "server-only";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { promises as dns } from "node:dns";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit, type Response as UndiciResponse } from "undici";

/**
 * Server-Side Request Forgery protection for every outbound request Vigil makes
 * (monitor probes and webhook replays).
 *
 * Defence in depth:
 *   1. Static validation — scheme, credentials, port, hostname deny-list, IP-literal ranges.
 *   2. Pre-flight DNS resolution — every A/AAAA record must be public.
 *   3. Connection-time pinning — a custom undici dispatcher re-validates the address
 *      the socket actually connects to, closing the DNS-rebinding TOCTOU gap.
 *   4. Redirects are never followed automatically (a 302 to 169.254.169.254 is a classic bypass).
 *
 * Vigil's own internal demo endpoints (`/api/sim/*` on this deployment's origin) are
 * explicitly allowed so the chaos simulator works on localhost.
 */

export class SsrfError extends Error {
  readonly code: SsrfCode;
  constructor(code: SsrfCode, message: string) {
    super(message);
    this.name = "SsrfError";
    this.code = code;
  }
}

export type SsrfCode =
  | "INVALID_URL"
  | "BAD_SCHEME"
  | "CREDENTIALS"
  | "BAD_PORT"
  | "BLOCKED_HOST"
  | "BLOCKED_IP"
  | "DNS_FAILURE";

// ─── Blocked ranges ───────────────────────────────────────────────────────────

const blocked = new BlockList();

// IPv4
const V4_RANGES: Array<[string, number, string]> = [
  ["0.0.0.0", 8, "this-network"],
  ["10.0.0.0", 8, "RFC1918 private"],
  ["100.64.0.0", 10, "carrier-grade NAT"],
  ["127.0.0.0", 8, "loopback"],
  ["169.254.0.0", 16, "link-local / cloud metadata"],
  ["172.16.0.0", 12, "RFC1918 private"],
  ["192.0.0.0", 24, "IETF protocol assignments"],
  ["192.0.2.0", 24, "TEST-NET-1"],
  ["192.88.99.0", 24, "6to4 relay anycast"],
  ["192.168.0.0", 16, "RFC1918 private"],
  ["198.18.0.0", 15, "benchmarking"],
  ["198.51.100.0", 24, "TEST-NET-2"],
  ["203.0.113.0", 24, "TEST-NET-3"],
  ["224.0.0.0", 4, "multicast"],
  ["240.0.0.0", 4, "reserved"],
];
for (const [net, prefix] of V4_RANGES) blocked.addSubnet(net, prefix, "ipv4");

// IPv6
const V6_RANGES: Array<[string, number, string]> = [
  ["::", 128, "unspecified"],
  ["::1", 128, "loopback"],
  ["fc00::", 7, "unique local"],
  ["fe80::", 10, "link-local"],
  ["fec0::", 10, "site-local (deprecated)"],
  ["ff00::", 8, "multicast"],
  ["2001:db8::", 32, "documentation"],
  ["100::", 64, "discard-only"],
];
for (const [net, prefix] of V6_RANGES) blocked.addSubnet(net, prefix, "ipv6");

/** Hostnames that must never be contacted regardless of what they resolve to. */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
  "instance-data.ec2.internal",
]);
const BLOCKED_SUFFIXES = [".localhost", ".internal", ".local", ".localdomain", ".home.arpa"];

const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"]);

// ─── IP classification ────────────────────────────────────────────────────────

/** Extract an embedded IPv4 address from IPv4-mapped / -compatible / NAT64 IPv6 forms. */
function embeddedIPv4(ipv6: string): string | null {
  const lower = ipv6.toLowerCase();
  // ::ffff:1.2.3.4  |  ::1.2.3.4  |  64:ff9b::1.2.3.4
  const dotted = lower.match(/^(?:::ffff:|::|64:ff9b::)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted?.[1]) return dotted[1];
  // ::ffff:7f00:1 (hex form of mapped address)
  const hex = lower.match(/^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex?.[1] && hex[2]) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return null;
}

/** Returns a human-readable reason if the IP is non-public, otherwise null. */
export function classifyIp(ip: string): string | null {
  const bare = ip.replace(/^\[|\]$/g, "").split("%")[0] ?? ip; // strip brackets & zone id
  const family = isIP(bare);
  if (family === 4) {
    if (!blocked.check(bare, "ipv4")) return null;
    return V4_RANGES.find(([net, prefix]) => {
      const bl = new BlockList();
      bl.addSubnet(net, prefix, "ipv4");
      return bl.check(bare, "ipv4");
    })?.[2] ?? "non-public IPv4";
  }
  if (family === 6) {
    const v4 = embeddedIPv4(bare);
    if (v4) return classifyIp(v4);
    if (!blocked.check(bare, "ipv6")) return null;
    return "non-public IPv6";
  }
  return "unparseable address";
}

export function isPublicIp(ip: string): boolean {
  return classifyIp(ip) === null;
}

// ─── Internal demo allowance ──────────────────────────────────────────────────

export const INTERNAL_SIM_PREFIX = "/api/sim/";

/** True when `raw` is a relative internal path like `/api/sim/checkout-api`. */
export function isRelativeSimPath(raw: string): boolean {
  return raw.startsWith(INTERNAL_SIM_PREFIX) && !raw.startsWith("//");
}

/** True when the URL points at this deployment's own `/api/sim/*` demo endpoints. */
export function isInternalSimUrl(url: URL, appOrigin: string): boolean {
  let origin: string;
  try {
    origin = new URL(appOrigin).origin;
  } catch {
    return false;
  }
  return (
    url.origin === origin &&
    url.pathname.startsWith(INTERNAL_SIM_PREFIX) &&
    // Reject path traversal such as /api/sim/../cron/probe
    !url.pathname.slice(INTERNAL_SIM_PREFIX.length).split("/").some((seg) => seg === ".." || seg === ".")
  );
}

// ─── Validation ───────────────────────────────────────────────────────────────

export interface ResolvedTarget {
  url: URL;
  /** True if this is Vigil's own `/api/sim/*` demo endpoint (SSRF checks skipped). */
  internal: boolean;
  /** Public addresses the hostname resolved to (empty for internal targets). */
  addresses: string[];
}

/**
 * Synchronous structural checks. Does not touch DNS.
 * Accepts relative `/api/sim/*` paths and resolves them against `appOrigin`.
 */
export function parseTarget(raw: string, appOrigin: string): { url: URL; internal: boolean } {
  let url: URL;
  try {
    url = isRelativeSimPath(raw) ? new URL(raw, appOrigin) : new URL(raw);
  } catch {
    throw new SsrfError("INVALID_URL", "Target is not a valid absolute URL.");
  }

  if (isInternalSimUrl(url, appOrigin)) return { url, internal: true };

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfError("BAD_SCHEME", `Scheme "${url.protocol}" is not allowed; use http or https.`);
  }
  if (url.username || url.password) {
    throw new SsrfError("CREDENTIALS", "Embedded credentials in URLs are not allowed.");
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    throw new SsrfError("BAD_PORT", `Port ${url.port} is not allowed. Permitted: 80, 443, 8080, 8443.`);
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) throw new SsrfError("INVALID_URL", "Target URL has no hostname.");
  if (BLOCKED_HOSTNAMES.has(host) || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new SsrfError("BLOCKED_HOST", `Hostname "${host}" is not reachable from Vigil.`);
  }

  const literal = host.replace(/^\[|\]$/g, "");
  if (isIP(literal)) {
    const reason = classifyIp(literal);
    if (reason) throw new SsrfError("BLOCKED_IP", `Address ${literal} is blocked (${reason}).`);
  } else if (/^[0-9.]+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) {
    // Octal / decimal / hex shorthand IPs ("2130706433", "0x7f.1") — WHATWG URL normalises most,
    // but refuse anything numeric that slipped through.
    throw new SsrfError("BLOCKED_IP", `Numeric host "${host}" is not allowed.`);
  }

  return { url, internal: false };
}

/** Full validation: structural checks + DNS resolution of every record. */
export async function resolveTarget(raw: string, appOrigin: string): Promise<ResolvedTarget> {
  const { url, internal } = parseTarget(raw, appOrigin);
  if (internal) return { url, internal, addresses: [] };

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return { url, internal, addresses: [host] };

  let records: LookupAddress[];
  try {
    records = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new SsrfError("DNS_FAILURE", `Could not resolve "${host}".`);
  }
  if (records.length === 0) throw new SsrfError("DNS_FAILURE", `"${host}" has no A/AAAA records.`);

  for (const r of records) {
    const reason = classifyIp(r.address);
    if (reason) {
      throw new SsrfError("BLOCKED_IP", `"${host}" resolves to ${r.address}, which is blocked (${reason}).`);
    }
  }
  return { url, internal, addresses: records.map((r) => r.address) };
}

// ─── Connection-time pinning ──────────────────────────────────────────────────

/**
 * A `net.connect` lookup that refuses non-public addresses. Because the check
 * happens on the exact address the socket uses, a hostname that rebinds to
 * 127.0.0.1 after pre-flight validation still cannot be reached.
 */
const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err, "", 4);
    const list = addresses as unknown as LookupAddress[];
    const bad = list.find((a) => !isPublicIp(a.address));
    if (bad || list.length === 0) {
      const e = new SsrfError("BLOCKED_IP", `Connection to ${bad?.address ?? hostname} refused by SSRF guard.`);
      return callback(e as NodeJS.ErrnoException, "", 4);
    }
    if (options.all) {
      (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
    } else {
      const first = list[0]!;
      callback(null, first.address, first.family);
    }
  });
};

let pinnedAgent: Agent | null = null;
function getPinnedAgent(): Agent {
  pinnedAgent ??= new Agent({
    connect: { lookup: guardedLookup, timeout: 10_000 },
    keepAliveTimeout: 4_000,
    maxRedirections: 0,
  } as ConstructorParameters<typeof Agent>[0]);
  return pinnedAgent;
}

export interface SafeFetchOptions extends Omit<UndiciRequestInit, "dispatcher" | "redirect" | "signal"> {
  timeoutMs?: number;
}

export interface SafeFetchResult {
  response: UndiciResponse;
  target: ResolvedTarget;
}

/**
 * Validate a target and perform the request with SSRF pinning, a hard timeout,
 * and redirects disabled (3xx responses are returned as-is to the caller).
 */
export async function safeFetch(
  raw: string,
  appOrigin: string,
  { timeoutMs = 10_000, ...init }: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const target = await resolveTarget(raw, appOrigin);
  const response = await undiciFetch(target.url, {
    ...init,
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
    // Internal sim endpoints live on our own origin (which may be localhost in dev).
    dispatcher: target.internal ? undefined : getPinnedAgent(),
  });
  return { response, target };
}
