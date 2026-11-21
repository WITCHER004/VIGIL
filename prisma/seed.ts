/**
 * Vigil seed — realistic telemetry so every screen is alive on first boot.
 *
 *   • 7 monitors (3 internal /api/sim/* services, 3 real public endpoints, 1 paused)
 *   • 30 days of check history: 10-minute resolution for the last 7 days,
 *     hourly before that, and 60-second resolution inside every incident window
 *   • Resolved incidents with operator timelines + one OPEN incident (Ledger Sync)
 *   • 3 webhook endpoints (Stripe / GitHub / Razorpay) with correctly signed events,
 *     one tampered signature, one missing signature, and replay history
 *
 * Deterministic: a fixed PRNG seed produces the same shape every run
 * (timestamps are relative to "now").
 *
 *   npx prisma db seed
 */
import { randomBytes } from "node:crypto";
import {
  HttpMethod,
  IncidentSeverity,
  IncidentStatus,
  MonitorStatus,
  Prisma,
  PrismaClient,
  SignatureScheme,
  SimMode,
  UpdateAuthor,
} from "@prisma/client";
import { signPayload, verifySignature } from "../src/lib/hmac";
import { samplePayload, type SampleProvider } from "../src/lib/sample-payloads";
import { SIM_SERVICES } from "../src/lib/sim";
import { advanceCounters, deriveStatus, INCIDENT_POLICY } from "../src/lib/stats";

const prisma = new PrismaClient();

// ─── Deterministic randomness ─────────────────────────────────────────────────

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(0x51_61_1e);

/** Standard normal via Box–Muller. */
function gaussian(): number {
  const u = Math.max(rng(), 1e-9);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = Date.now();

// ─── Monitor catalogue ────────────────────────────────────────────────────────

interface Window {
  /** ms before NOW the window starts */
  startAgo: number;
  durationMs: number;
  kind: "outage" | "latency";
  statusCode?: number | null; // null → timeout
  incident?: {
    title: string;
    severity: IncidentSeverity;
    identified: string;
    resolvedNote?: string;
  };
}

interface MonitorSeed {
  key: string;
  name: string;
  url: string;
  method?: HttpMethod;
  expectedStatus?: number;
  bodyContains?: string;
  baseLatency: number;
  sigma: number;
  degradedThresholdMs: number;
  intervalSec: number;
  timeoutMs?: number;
  onStatusPage: boolean;
  paused?: boolean;
  windows: Window[];
  /** Open incident still in progress at NOW */
  open?: { startAgo: number; title: string; severity: IncidentSeverity; identified: string };
}

const MONITORS: MonitorSeed[] = [
  {
    key: "checkout",
    name: "Checkout API",
    url: "/api/sim/checkout-api",
    bodyContains: '"status":"ok"',
    baseLatency: 45,
    sigma: 0.22,
    degradedThresholdMs: 400,
    intervalSec: 60,
    onStatusPage: true,
    windows: [
      {
        startAgo: 3 * DAY + 2 * HOUR + 10 * MIN,
        durationMs: 42 * MIN,
        kind: "outage",
        statusCode: 503,
        incident: {
          title: "Checkout API returning 503 Service Unavailable",
          severity: IncidentSeverity.CRITICAL,
          identified:
            "Connection pool exhaustion on the primary Postgres replica after a long-running analytics query. Query killed; pool size raised from 20 → 40.",
          resolvedNote: "Error rate back to baseline. Post-incident review scheduled.",
        },
      },
      { startAgo: 26 * HOUR, durationMs: 35 * MIN, kind: "latency" },
    ],
  },
  {
    key: "auth",
    name: "Auth Gateway",
    url: "/api/sim/auth-gateway",
    bodyContains: '"status":"ok"',
    baseLatency: 62,
    sigma: 0.2,
    degradedThresholdMs: 450,
    intervalSec: 60,
    onStatusPage: true,
    windows: [
      {
        startAgo: 9 * DAY + 5 * HOUR,
        durationMs: 18 * MIN,
        kind: "outage",
        statusCode: 502,
        incident: {
          title: "Elevated 502s on token issuance",
          severity: IncidentSeverity.MAJOR,
          identified: "JWKS cache served a revoked signing key after scheduled key rotation. Cache flushed across edge nodes.",
        },
      },
      { startAgo: 4 * DAY + 7 * HOUR, durationMs: 50 * MIN, kind: "latency" },
    ],
  },
  {
    key: "ledger",
    name: "Ledger Sync",
    url: "/api/sim/ledger-sync",
    bodyContains: '"status":"ok"',
    baseLatency: 140,
    sigma: 0.28,
    degradedThresholdMs: 650,
    intervalSec: 60,
    onStatusPage: true,
    windows: [
      {
        startAgo: 21 * DAY + 3 * HOUR,
        durationMs: 65 * MIN,
        kind: "outage",
        statusCode: null,
        incident: {
          title: "Ledger Sync timing out",
          severity: IncidentSeverity.MAJOR,
          identified: "Upstream bank SFTP gateway unreachable from iad1. Failover to secondary region initiated.",
        },
      },
    ],
    open: {
      startAgo: 47 * MIN,
      title: "Ledger Sync unavailable — reconciliation jobs paused",
      severity: IncidentSeverity.CRITICAL,
      identified:
        "Message broker partition 3 is rejecting writes after a disk-full event. Draining backlog to a fresh volume; ETA ~30 min.",
    },
  },
  {
    key: "github",
    name: "GitHub Status API",
    url: "https://www.githubstatus.com/api/v2/status.json",
    bodyContains: '"indicator"',
    baseLatency: 118,
    sigma: 0.3,
    degradedThresholdMs: 800,
    intervalSec: 300,
    onStatusPage: false,
    windows: [{ startAgo: 6 * DAY + 11 * HOUR, durationMs: 40 * MIN, kind: "latency" }],
  },
  {
    key: "npm",
    name: "npm Registry",
    url: "https://registry.npmjs.org/-/ping",
    baseLatency: 92,
    sigma: 0.26,
    degradedThresholdMs: 700,
    intervalSec: 120,
    onStatusPage: true,
    windows: [
      {
        startAgo: 5 * DAY + 9 * HOUR,
        durationMs: 12 * MIN,
        kind: "outage",
        statusCode: 503,
        incident: {
          title: "npm Registry ping failing",
          severity: IncidentSeverity.MINOR,
          identified: "Upstream registry incident acknowledged by provider. Monitoring only — no action required on our side.",
        },
      },
    ],
  },
  {
    key: "edge",
    name: "Cloudflare Edge Trace",
    url: "https://www.cloudflare.com/cdn-cgi/trace",
    bodyContains: "fl=",
    baseLatency: 31,
    sigma: 0.35,
    degradedThresholdMs: 300,
    intervalSec: 60,
    onStatusPage: true,
    windows: [
      {
        startAgo: 16 * DAY + 20 * HOUR,
        durationMs: 7 * MIN,
        kind: "outage",
        statusCode: null,
        incident: {
          title: "Edge trace unreachable from probe region",
          severity: IncidentSeverity.MINOR,
          identified: "Transit provider route flap between iad1 and the nearest PoP. Resolved by upstream re-convergence.",
        },
      },
    ],
  },
  {
    key: "legacy",
    name: "Legacy Billing (sunset)",
    url: "https://example.com/",
    bodyContains: "Example Domain",
    baseLatency: 210,
    sigma: 0.3,
    degradedThresholdMs: 900,
    intervalSec: 600,
    onStatusPage: false,
    paused: true,
    windows: [],
  },
];

// ─── Telemetry generation ─────────────────────────────────────────────────────

interface Sample {
  checkedAt: Date;
  ok: boolean;
  statusCode: number | null;
  latencyMs: number;
  statusOk: boolean;
  bodyOk: boolean | null;
  error: string | null;
}

/** Diurnal load curve: busiest ~14:00 UTC, quietest ~02:00 UTC. */
function diurnal(t: number): number {
  const hour = new Date(t).getUTCHours() + new Date(t).getUTCMinutes() / 60;
  return 1 + 0.18 * Math.sin(((hour - 8) / 24) * 2 * Math.PI);
}

function healthyLatency(m: MonitorSeed, t: number): number {
  let v = m.baseLatency * Math.exp(m.sigma * gaussian()) * diurnal(t);
  if (rng() < 0.012) v *= 3 + rng() * 4; // rare tail spikes → realistic p99
  return Math.max(4, Math.round(v));
}

function makeSample(m: MonitorSeed, t: number, w?: Window | { kind: "outage"; statusCode: number | null }): Sample {
  const hasBody = m.bodyContains != null;
  if (w?.kind === "outage") {
    const code = w.statusCode ?? null;
    return {
      checkedAt: new Date(t),
      ok: false,
      statusCode: code,
      latencyMs: code == null ? 10_000 : Math.round(m.baseLatency * (0.6 + rng() * 0.8)),
      statusOk: false,
      bodyOk: hasBody ? false : null,
      error: code == null ? "Request timed out after 10000ms" : `Expected HTTP ${m.expectedStatus ?? 200}, received ${code}`,
    };
  }
  if (w?.kind === "latency") {
    const target = m.degradedThresholdMs * (1.3 + rng() * 0.9);
    return {
      checkedAt: new Date(t),
      ok: true,
      statusCode: m.expectedStatus ?? 200,
      latencyMs: Math.round(target),
      statusOk: true,
      bodyOk: hasBody ? true : null,
      error: null,
    };
  }
  // Background noise: ~0.12% isolated transient failures (never 3 in a row → no incident)
  if (rng() < 0.0012) {
    return {
      checkedAt: new Date(t),
      ok: false,
      statusCode: null,
      latencyMs: 10_000,
      statusOk: false,
      bodyOk: hasBody ? false : null,
      error: "Request timed out after 10000ms",
    };
  }
  return {
    checkedAt: new Date(t),
    ok: true,
    statusCode: m.expectedStatus ?? 200,
    latencyMs: healthyLatency(m, t),
    statusOk: true,
    bodyOk: hasBody ? true : null,
    error: null,
  };
}

function generateSamples(m: MonitorSeed): Sample[] {
  const start = NOW - 30 * DAY;
  const denseFrom = NOW - 7 * DAY;
  const stopAt = m.paused ? NOW - 2 * DAY : NOW; // paused monitors stopped reporting
  const windows = m.windows.map((w) => ({ ...w, s: NOW - w.startAgo, e: NOW - w.startAgo + w.durationMs }));
  const openStart = m.open ? NOW - m.open.startAgo : Infinity;
  const inSpecial = (t: number) => t >= openStart || windows.some((w) => t >= w.s && t < w.e + 3 * MIN);

  const out: Sample[] = [];

  // Base timeline (skipping incident windows, which get dense sampling below)
  const step = (t: number) => (t < denseFrom ? HOUR : Math.max(10 * MIN, m.intervalSec * 1000));
  for (let t = start + Math.floor(rng() * 5 * MIN); t < stopAt; t += step(t)) {
    if (!inSpecial(t)) out.push(makeSample(m, t));
  }

  // Dense 60s sampling across each window (+3 min tail so recovery is captured)
  for (const w of windows) {
    for (let t = w.s; t < w.e + 3 * MIN && t < stopAt; t += MIN) {
      out.push(makeSample(m, t, t < w.e ? w : undefined));
    }
  }

  // Open incident: failing every minute until now
  if (m.open) {
    for (let t = openStart; t <= NOW - 20_000; t += MIN) {
      out.push(makeSample(m, t, { kind: "outage", statusCode: 503 }));
    }
  }

  return out.sort((a, b) => a.checkedAt.getTime() - b.checkedAt.getTime());
}

/**
 * Replay the incident state machine over a window's samples so the stored
 * incident start / resolution times match the telemetry exactly.
 */
function incidentBounds(samples: Sample[], fromMs: number, toMs: number) {
  let counters = { consecutiveFailures: 0, consecutiveSuccesses: 0, hasOpenIncident: false };
  let firstFailure: Date | null = null;
  let openedAt: Date | null = null;
  let resolvedAt: Date | null = null;
  for (const s of samples) {
    const t = s.checkedAt.getTime();
    if (t < fromMs) continue;
    if (t > toMs) break;
    const next = advanceCounters(counters, s.ok);
    // Downtime is measured from the first failure of the streak that opened the incident.
    if (!s.ok && next.consecutiveFailures === 1 && !counters.hasOpenIncident) firstFailure = s.checkedAt;
    if (next.action === "open") openedAt = s.checkedAt;
    if (next.action === "resolve") {
      resolvedAt = s.checkedAt;
      break;
    }
    counters = {
      consecutiveFailures: next.consecutiveFailures,
      consecutiveSuccesses: next.consecutiveSuccesses,
      hasOpenIncident: counters.hasOpenIncident || next.action === "open",
    };
  }
  return { firstFailure, openedAt, resolvedAt };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("› Clearing existing data…");
  await prisma.$transaction([
    prisma.webhookReplay.deleteMany(),
    prisma.webhookEvent.deleteMany(),
    prisma.webhookEndpoint.deleteMany(),
    prisma.incidentUpdate.deleteMany(),
    prisma.incident.deleteMany(),
    prisma.checkRun.deleteMany(),
    prisma.monitor.deleteMany(),
    prisma.statusPage.deleteMany(),
    prisma.simService.deleteMany(),
  ]);

  // Simulator services
  await prisma.simService.createMany({
    data: SIM_SERVICES.map((s) => ({ id: s.id, label: s.label, mode: SimMode[s.defaultMode] })),
  });

  const statusPage = await prisma.statusPage.create({
    data: {
      slug: "vigil",
      title: "Vigil Systems",
      description: "Live availability for the Vigil platform and the upstreams it depends on.",
    },
  });

  let totalChecks = 0;
  let totalIncidents = 0;

  for (const m of MONITORS) {
    const samples = generateSamples(m);
    const last = samples[samples.length - 1];

    // Final rolling counters, replayed through the real state machine
    let counters = { consecutiveFailures: 0, consecutiveSuccesses: 0, hasOpenIncident: false };
    for (const s of samples.slice(-10)) {
      const next = advanceCounters(counters, s.ok);
      counters = {
        consecutiveFailures: next.consecutiveFailures,
        consecutiveSuccesses: next.consecutiveSuccesses,
        hasOpenIncident: next.action === "open" ? true : next.action === "resolve" ? false : counters.hasOpenIncident,
      };
    }
    const hasOpen = Boolean(m.open);
    const status: MonitorStatus = m.paused
      ? MonitorStatus.PAUSED
      : last
        ? (deriveStatus({
            ok: last.ok,
            latencyMs: last.latencyMs,
            degradedThresholdMs: m.degradedThresholdMs,
            consecutiveFailures: counters.consecutiveFailures,
            hasOpenIncident: hasOpen,
          }) as MonitorStatus)
        : MonitorStatus.PENDING;

    const monitor = await prisma.monitor.create({
      data: {
        name: m.name,
        url: m.url,
        method: m.method ?? HttpMethod.GET,
        expectedStatus: m.expectedStatus ?? 200,
        timeoutMs: m.timeoutMs ?? 10_000,
        intervalSec: m.intervalSec,
        bodyContains: m.bodyContains ?? null,
        degradedThresholdMs: m.degradedThresholdMs,
        isPaused: Boolean(m.paused),
        status,
        consecutiveFailures: counters.consecutiveFailures,
        consecutiveSuccesses: counters.consecutiveSuccesses,
        lastCheckedAt: last?.checkedAt ?? null,
        lastLatencyMs: last?.latencyMs ?? null,
        lastStatusCode: last?.statusCode ?? null,
        statusPageId: m.onStatusPage ? statusPage.id : null,
        createdAt: new Date(NOW - 31 * DAY),
      },
    });

    // Check runs in chunks
    const CHUNK = 2_000;
    for (let i = 0; i < samples.length; i += CHUNK) {
      await prisma.checkRun.createMany({
        data: samples.slice(i, i + CHUNK).map((s) => ({ ...s, monitorId: monitor.id, source: "seed" })),
      });
    }
    totalChecks += samples.length;

    // Resolved incidents derived from the telemetry
    for (const w of m.windows) {
      if (!w.incident) continue;
      const s = NOW - w.startAgo;
      const { firstFailure, openedAt, resolvedAt } = incidentBounds(samples, s - MIN, s + w.durationMs + 10 * MIN);
      if (!firstFailure || !openedAt || !resolvedAt) continue;
      const downtimeSec = Math.round((resolvedAt.getTime() - firstFailure.getTime()) / 1000);
      const identifiedAt = new Date(openedAt.getTime() + Math.min(9 * MIN, (resolvedAt.getTime() - openedAt.getTime()) / 2));
      await prisma.incident.create({
        data: {
          monitorId: monitor.id,
          title: w.incident.title,
          severity: w.incident.severity,
          status: IncidentStatus.RESOLVED,
          startedAt: firstFailure,
          resolvedAt,
          downtimeSec,
          createdAt: openedAt,
          updates: {
            create: [
              {
                status: IncidentStatus.INVESTIGATING,
                author: UpdateAuthor.SYSTEM,
                message: `${INCIDENT_POLICY.failureThreshold} consecutive failed checks — ${
                  w.statusCode == null ? "requests timing out after 10000ms" : `HTTP ${w.statusCode}`
                }. Incident opened automatically.`,
                createdAt: openedAt,
              },
              {
                status: IncidentStatus.IDENTIFIED,
                author: UpdateAuthor.OPERATOR,
                message: w.incident.identified,
                createdAt: identifiedAt,
              },
              ...(w.incident.resolvedNote
                ? [
                    {
                      status: IncidentStatus.RESOLVED,
                      author: UpdateAuthor.OPERATOR,
                      message: w.incident.resolvedNote,
                      createdAt: new Date(resolvedAt.getTime() + 4 * MIN),
                    },
                  ]
                : []),
              {
                status: IncidentStatus.RESOLVED,
                author: UpdateAuthor.SYSTEM,
                message: `${INCIDENT_POLICY.recoveryThreshold} consecutive successful checks. Auto-resolved after ${Math.round(
                  downtimeSec / 60,
                )}m of downtime.`,
                createdAt: resolvedAt,
              },
            ],
          },
        },
      });
      totalIncidents++;
    }

    // Open incident
    if (m.open) {
      const s = NOW - m.open.startAgo;
      const { firstFailure, openedAt } = incidentBounds(samples, s - MIN, NOW);
      if (firstFailure && openedAt) {
        await prisma.incident.create({
          data: {
            monitorId: monitor.id,
            title: m.open.title,
            severity: m.open.severity,
            status: IncidentStatus.IDENTIFIED,
            startedAt: firstFailure,
            createdAt: openedAt,
            updates: {
              create: [
                {
                  status: IncidentStatus.INVESTIGATING,
                  author: UpdateAuthor.SYSTEM,
                  message: `${INCIDENT_POLICY.failureThreshold} consecutive failed checks — HTTP 503. Incident opened automatically.`,
                  createdAt: openedAt,
                },
                {
                  status: IncidentStatus.IDENTIFIED,
                  author: UpdateAuthor.OPERATOR,
                  message: m.open.identified,
                  createdAt: new Date(openedAt.getTime() + 11 * MIN),
                },
              ],
            },
          },
        });
        totalIncidents++;
      }
    }

    console.log(`  ✓ ${m.name.padEnd(26)} ${String(samples.length).padStart(5)} checks · ${status}`);
  }

  // ─── Webhooks ───────────────────────────────────────────────────────────────

  const ENDPOINTS: Array<{ name: string; provider: SampleProvider; scheme: SignatureScheme; count: number }> = [
    { name: "Stripe · Production", provider: "stripe", scheme: SignatureScheme.STRIPE, count: 9 },
    { name: "GitHub · vigil-labs", provider: "github", scheme: SignatureScheme.GITHUB, count: 7 },
    { name: "Razorpay · India", provider: "razorpay", scheme: SignatureScheme.RAZORPAY, count: 5 },
  ];
  const SOURCE_IPS: Record<SampleProvider, string[]> = {
    stripe: ["3.18.12.63", "3.130.192.231", "13.235.14.237", "54.187.174.169"],
    github: ["140.82.115.12", "140.82.115.98", "192.30.252.44"],
    razorpay: ["13.232.125.214", "52.66.111.41", "13.126.199.247"],
  };

  let totalEvents = 0;
  const replayCandidates: { id: string; body: string; headers: Record<string, string> }[] = [];

  for (const ep of ENDPOINTS) {
    const secret =
      ep.provider === "stripe"
        ? `whsec_${randomBytes(18).toString("base64url")}`
        : randomBytes(24).toString("base64url");
    const endpoint = await prisma.webhookEndpoint.create({
      data: {
        name: ep.name,
        token: `whk_${randomBytes(12).toString("base64url")}`,
        signatureScheme: ep.scheme,
        secret,
        createdAt: new Date(NOW - 14 * DAY),
      },
    });

    for (let i = 0; i < ep.count; i++) {
      const receivedAt = NOW - Math.round((i * 3.1 + rng() * 2.4) * HOUR) - Math.round(rng() * 40 * MIN);
      const atSec = Math.floor(receivedAt / 1000);
      const sample = samplePayload(ep.provider, rng, atSec);
      const rawBody = JSON.stringify(sample.body);

      let signature = signPayload(ep.scheme, secret, rawBody, atSec);
      // A few realistic failure cases for the HMAC status column
      if (i === 2 && ep.provider === "stripe") {
        signature = signPayload(ep.scheme, "whsec_rotated_old_secret", rawBody, atSec); // stale secret
      }
      if (i === 4 && ep.provider === "github") signature = {}; // missing signature

      const headers: Record<string, string> = {
        host: "vigil.app",
        "user-agent": sample.userAgent,
        accept: "*/*",
        "content-length": String(Buffer.byteLength(rawBody)),
        ...sample.headers,
        ...signature,
        "x-forwarded-for": SOURCE_IPS[ep.provider][i % SOURCE_IPS[ep.provider].length]!,
        "x-forwarded-proto": "https",
      };
      const signatureStatus = verifySignature(ep.scheme, secret, headers, rawBody, atSec);

      const event = await prisma.webhookEvent.create({
        data: {
          endpointId: endpoint.id,
          method: "POST",
          path: `/api/ingest/${endpoint.token}`,
          headers,
          query: ep.provider === "github" ? {} : { source: "live" },
          sourceIp: headers["x-forwarded-for"] ?? null,
          contentType: headers["content-type"] ?? null,
          sizeBytes: Buffer.byteLength(rawBody),
          rawBody,
          jsonBody: sample.body as Prisma.InputJsonValue,
          eventType: sample.eventType,
          signatureStatus,
          receivedAt: new Date(receivedAt),
        },
      });
      if (i < 2) replayCandidates.push({ id: event.id, body: rawBody, headers });
      totalEvents++;
    }
  }

  // Replay history
  const REPLAY_TARGETS = [
    { url: "https://httpbin.org/post", status: 200, latency: 412, body: '{"json":{"ok":true},"origin":"76.76.21.21"}' },
    { url: "https://staging.vigil.app/webhooks/stripe", status: 502, latency: 1840, body: "Bad Gateway" },
    { url: "https://httpbin.org/anything", status: 200, latency: 388, body: '{"method":"POST","origin":"76.76.21.21"}' },
  ];
  let totalReplays = 0;
  for (const [i, c] of replayCandidates.slice(0, 4).entries()) {
    const target = REPLAY_TARGETS[i % REPLAY_TARGETS.length]!;
    await prisma.webhookReplay.create({
      data: {
        eventId: c.id,
        targetUrl: target.url,
        method: "POST",
        requestHeaders: { "content-type": c.headers["content-type"] ?? "application/json", "x-vigil-replay": "1" },
        requestBody: c.body,
        responseStatus: target.status,
        responseHeaders: { "content-type": target.status === 200 ? "application/json" : "text/plain" },
        responseBody: target.body,
        latencyMs: target.latency,
        error: target.status >= 500 ? `Target responded with HTTP ${target.status}` : null,
        createdAt: new Date(NOW - (i + 1) * 47 * MIN),
      },
    });
    totalReplays++;
  }

  console.log(
    `\n✔ Seeded ${MONITORS.length} monitors · ${totalChecks.toLocaleString()} checks · ${totalIncidents} incidents · ` +
      `${totalEvents} webhook events · ${totalReplays} replays`,
  );
  console.log(`  Public status page → /status/${statusPage.slug}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
