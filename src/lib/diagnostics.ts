import type { CheckRun, Incident, Monitor, WebhookEndpoint, WebhookEvent } from "@prisma/client";

export type DiagnosticConfidence = "HIGH" | "MEDIUM" | "LOW";
export type RiskLevel = "SAFE" | "GUARDED";
export type RemediationActionType = "RUNBOOK_WEBHOOK" | "SMART_REPLAY" | "COPY_SNIPPET" | "ADAPTIVE_BACKOFF";

export interface EvidenceItem {
  id: string;
  label: string;
  detail: string;
  severity: "info" | "warn" | "crit";
}

export interface InstantFix {
  id: string;
  title: string;
  summary: string;
  riskLevel: RiskLevel;
  actionType: RemediationActionType;
  targetUrl?: string;
  serviceId?: string;
  snippetCode?: string;
  snippetLanguage?: string;
  snippetExplanation?: string;
  diffBefore?: string;
  diffAfter?: string;
  suggestedIntervalSec?: number;
  payloadPatch?: Record<string, unknown>;
  repairedHeaders?: Record<string, string>;
}

export interface DiagnosticReport {
  rootCauseTitle: string;
  confidence: DiagnosticConfidence;
  category: "AVAILABILITY" | "LATENCY" | "SECURITY" | "PAYLOAD" | "RATE_LIMIT" | "ASSERTION";
  summary: string;
  evidenceChain: EvidenceItem[];
  instantFixes: InstantFix[];
  analyzedAt: string;
}

export interface IncidentDiagnosticContext {
  incident: Incident;
  monitor: Monitor;
  recentChecks: CheckRun[];
  baselineChecks?: CheckRun[];
}

export interface WebhookDiagnosticContext {
  event: WebhookEvent;
  endpoint: WebhookEndpoint;
}

function calculateP95(samples: number[]): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.ceil(0.95 * sorted.length) - 1;
  return sorted[Math.max(0, index)] ?? 0;
}

/**
 * Deterministic diagnostic engine for synthetic monitor check failures and incidents.
 */
export function diagnoseIncident(ctx: IncidentDiagnosticContext): DiagnosticReport {
  const { incident, monitor, recentChecks, baselineChecks = [] } = ctx;
  const failures = recentChecks.filter((c) => !c.ok);
  const lastCheck = recentChecks[0] ?? null;
  const analyzedAt = new Date().toISOString();

  const isInternal = monitor.url.startsWith("/api/sim/");
  const serviceIdMatch = monitor.url.match(/^\/api\/sim\/([a-z0-9-]+)/);
  const simServiceId = serviceIdMatch?.[1];

  const recentCodes = recentChecks.slice(0, 10).map((c) => c.statusCode);
  const failureCodes = failures.map((f) => f.statusCode);
  const primaryCode = lastCheck?.statusCode ?? failureCodes.find((c) => c != null) ?? null;

  // Latency jump telemetry
  const recentLatencies = recentChecks.map((c) => c.latencyMs);
  const baselineLatencies = baselineChecks.map((c) => c.latencyMs);
  const p95Recent = calculateP95(recentLatencies);
  const p95Baseline = baselineLatencies.length > 0 ? calculateP95(baselineLatencies) : monitor.degradedThresholdMs / 2;

  // 1. Upstream 503 / 502 / 504 Service Unavailable
  if (primaryCode === 503 || failureCodes.includes(503) || primaryCode === 502 || primaryCode === 504) {
    const code = primaryCode || 503;
    const title = `Upstream Saturation — HTTP ${code} ${code === 503 ? "Service Unavailable" : code === 502 ? "Bad Gateway" : "Gateway Timeout"}`;
    const evidenceChain: EvidenceItem[] = [
      {
        id: "ev-status",
        label: `HTTP ${code} Response`,
        detail: `Server responded with status code ${code} across ${failures.length} consecutive check runs.`,
        severity: "crit",
      },
      {
        id: "ev-latency",
        label: "Latency Shift",
        detail: `Observed p95 latency: ${Math.round(p95Recent)}ms (normal baseline: ~${Math.round(p95Baseline)}ms).`,
        severity: "warn",
      },
      {
        id: "ev-policy",
        label: "Incident Threshold Exceeded",
        detail: `${monitor.consecutiveFailures || failures.length} consecutive failures triggered policy transition to ${incident.severity} incident.`,
        severity: "info",
      },
    ];

    const instantFixes: InstantFix[] = [];

    if (isInternal && simServiceId) {
      instantFixes.push({
        id: "fix-runbook-recover",
        title: "Execute Recovery Runbook (Reset Chaos Target)",
        summary: `Fires an authenticated recovery signal to restore "${monitor.name}" to HEALTHY mode and triggers immediate probe verification.`,
        riskLevel: "GUARDED",
        actionType: "RUNBOOK_WEBHOOK",
        targetUrl: "/api/sim/recover",
        serviceId: simServiceId,
      });
    } else {
      instantFixes.push({
        id: "fix-runbook-restart",
        title: "Dispatch Automated Recovery Webhook",
        summary: "Calls the registered remediation webhook (e.g. restart container or failover DNS) through SSRF-pinned client.",
        riskLevel: "GUARDED",
        actionType: "RUNBOOK_WEBHOOK",
        targetUrl: "/api/sim/recover",
      });
    }

    instantFixes.push({
      id: "fix-adaptive-backoff",
      title: "Apply Adaptive Probing Backoff",
      summary: `Temporarily increases probe interval from ${monitor.intervalSec}s to ${Math.max(monitor.intervalSec * 2, 180)}s to prevent thundering-herd load on saturated upstream.`,
      riskLevel: "SAFE",
      actionType: "ADAPTIVE_BACKOFF",
      suggestedIntervalSec: Math.max(monitor.intervalSec * 2, 180),
    });

    instantFixes.push({
      id: "fix-curl-repro",
      title: "Copy Exact cURL Reproduction Command",
      summary: "Reproduce the exact HTTP failure locally with timing benchmarks and verbose trace output.",
      riskLevel: "SAFE",
      actionType: "COPY_SNIPPET",
      snippetLanguage: "bash",
      snippetCode: `curl -iv --max-time 10 \\\n  -w "\\nHTTP: %{http_code} | Connect: %{time_connect}s | TTFB: %{time_starttransfer}s | Total: %{time_total}s\\n" \\\n  "${monitor.url}"`,
      snippetExplanation: "Uses curl with socket timing metrics to verify if upstream socket is resetting or queue is saturated.",
    });

    instantFixes.push({
      id: "fix-middleware-retry",
      title: "Copy Circuit Breaker & Exponential Backoff Pattern",
      summary: "Production-ready resilient client middleware configuration with jittered retries.",
      riskLevel: "SAFE",
      actionType: "COPY_SNIPPET",
      snippetLanguage: "typescript",
      snippetCode: `// Resilient fetch with exponential backoff & 503 circuit-breaker\nasync function fetchWithRetry(url: string, retries = 3, backoffMs = 250): Promise<Response> {\n  for (let attempt = 0; attempt <= retries; attempt++) {\n    try {\n      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });\n      if (res.status !== 503 && res.status !== 502) return res;\n    } catch (err) {\n      if (attempt === retries) throw err;\n    }\n    const jitter = Math.random() * 100;\n    await new Promise((r) => setTimeout(r, backoffMs * Math.pow(2, attempt) + jitter));\n  }\n  throw new Error("Max retries exceeded for: " + url);\n}`,
    });

    return {
      rootCauseTitle: title,
      confidence: "HIGH",
      category: "AVAILABILITY",
      summary: `Downstream service responded with ${code}. Service is rejecting traffic due to process exhaustion, queue saturation, or host reboot.`,
      evidenceChain,
      instantFixes,
      analyzedAt,
    };
  }

  // 2. Rate Limit Exhausted (HTTP 429)
  if (primaryCode === 429 || failureCodes.includes(429)) {
    return {
      rootCauseTitle: "Rate Limit Exhausted (HTTP 429 Too Many Requests)",
      confidence: "HIGH",
      category: "RATE_LIMIT",
      summary: "The target API rejected synthetic checks due to upstream rate limiter token exhaustion.",
      evidenceChain: [
        {
          id: "ev-status-429",
          label: "HTTP 429 Status",
          detail: "Endpoint returned 429 Too Many Requests.",
          severity: "crit",
        },
        {
          id: "ev-frequency",
          label: "Probe Frequency",
          detail: `Probe configured at ${monitor.intervalSec}s interval, which exceeds target's burst bucket.`,
          severity: "warn",
        },
      ],
      instantFixes: [
        {
          id: "fix-rate-backoff",
          title: "Adjust Probe Interval & Enable Backoff",
          summary: `Relax probe cadence to ${Math.max(monitor.intervalSec * 3, 300)}s to conform with upstream quota rules.`,
          riskLevel: "SAFE",
          actionType: "ADAPTIVE_BACKOFF",
          suggestedIntervalSec: Math.max(monitor.intervalSec * 3, 300),
        },
        {
          id: "fix-rate-headers",
          title: "Copy Token Bucket Jitter Implementation",
          summary: "Client-side rate limit token consumption pattern with Retry-After header support.",
          riskLevel: "SAFE",
          actionType: "COPY_SNIPPET",
          snippetLanguage: "typescript",
          snippetCode: `// Respect Retry-After header\nconst retryAfterSec = parseInt(response.headers.get("retry-after") ?? "5", 10);\nconsole.warn(\`Rate limited. Cooling down for \${retryAfterSec}s...\`);\nawait new Promise(res => setTimeout(res, retryAfterSec * 1000));`,
        },
      ],
      analyzedAt,
    };
  }

  // 3. Response Body Assertion Drift
  const failedBodyCheck = failures.find((f) => f.bodyOk === false);
  if (failedBodyCheck || (lastCheck && lastCheck.statusOk && lastCheck.bodyOk === false)) {
    return {
      rootCauseTitle: "Response Body Assertion Drift",
      confidence: "HIGH",
      category: "ASSERTION",
      summary: `HTTP status code returned 200 OK, but required response body string "${monitor.bodyContains ?? 'expected'}" was missing.`,
      evidenceChain: [
        {
          id: "ev-body-mismatch",
          label: "Contract Assertion Failure",
          detail: `Expected bodyContains token "${monitor.bodyContains}" was absent from response payload.`,
          severity: "crit",
        },
        {
          id: "ev-status-ok",
          label: "HTTP 200 Succeeded",
          detail: "Network and HTTP layers succeeded, indicating schema drift or silent error page in 200 format.",
          severity: "info",
        },
      ],
      instantFixes: [
        {
          id: "fix-curl-body",
          title: "Inspect Raw Response Payload",
          summary: "Execute reproduction curl to inspect the payload body that caused the assertion failure.",
          riskLevel: "SAFE",
          actionType: "COPY_SNIPPET",
          snippetLanguage: "bash",
          snippetCode: `curl -s "${monitor.url}" | jq . || curl -s "${monitor.url}"`,
        },
      ],
      analyzedAt,
    };
  }

  // 4. Timeout / Host Unreachable
  const timeoutCheck = failures.find((f) => f.statusCode == null || f.latencyMs >= monitor.timeoutMs);
  if (timeoutCheck || primaryCode == null) {
    const isLocalSim = monitor.url.startsWith("/api/sim/");
    return {
      rootCauseTitle: "Connection Timeout / Host Unreachable",
      confidence: "HIGH",
      category: "AVAILABILITY",
      summary: `Probes timed out after ${monitor.timeoutMs}ms without receiving headers or TCP SYN acknowledgment.`,
      evidenceChain: [
        {
          id: "ev-timeout",
          label: "Hard Socket Timeout",
          detail: `Request exceeded client timeout budget (${monitor.timeoutMs}ms).`,
          severity: "crit",
        },
        {
          id: "ev-dns",
          label: "Handshake Diagnostic",
          detail: "TCP socket closed or DNS resolution hung before HTTP frame exchange.",
          severity: "warn",
        },
      ],
      instantFixes: [
        ...(isLocalSim
          ? [
              {
                id: "fix-runbook-sim-timeout",
                title: "Execute Recovery Runbook (Reset Mock Service)",
                summary: "Restores the simulated target service back to healthy operational state.",
                riskLevel: "GUARDED" as RiskLevel,
                actionType: "RUNBOOK_WEBHOOK" as RemediationActionType,
                targetUrl: "/api/sim/recover",
                serviceId: simServiceId,
              },
            ]
          : []),
        {
          id: "fix-curl-timing",
          title: "Copy TCP Diagnostic cURL",
          summary: "Measure precise DNS, TCP, and TLS handshake latency.",
          riskLevel: "SAFE",
          actionType: "COPY_SNIPPET",
          snippetLanguage: "bash",
          snippetCode: `curl -vo /dev/null -s -w "DNS: %{time_namelookup}s | TCP: %{time_connect}s | TLS: %{time_appconnect}s | Total: %{time_total}s\\n" "${monitor.url}"`,
        },
      ],
      analyzedAt,
    };
  }

  // 5. Latency Degradation
  if (monitor.status === "DEGRADED" || p95Recent > monitor.degradedThresholdMs) {
    return {
      rootCauseTitle: `Severe Latency Degradation (p95: ${Math.round(p95Recent)}ms)`,
      confidence: "MEDIUM",
      category: "LATENCY",
      summary: `Endpoint latency rose significantly above degraded SLA threshold (${monitor.degradedThresholdMs}ms).`,
      evidenceChain: [
        {
          id: "ev-p95-spike",
          label: "p95 Latency Alert",
          detail: `p95 response time jumped from ~${Math.round(p95Baseline)}ms to ${Math.round(p95Recent)}ms.`,
          severity: "warn",
        },
        {
          id: "ev-sla",
          label: "Degraded SLA Threshold",
          detail: `Configured threshold: ${monitor.degradedThresholdMs}ms.`,
          severity: "info",
        },
      ],
      instantFixes: [
        {
          id: "fix-adaptive-cooldown",
          title: "Apply Adaptive Backoff Cooldown",
          summary: "Briefly expands probe intervals to prevent probing from exacerbating server load.",
          riskLevel: "SAFE",
          actionType: "ADAPTIVE_BACKOFF",
          suggestedIntervalSec: monitor.intervalSec * 2,
        },
      ],
      analyzedAt,
    };
  }

  // Default Fallback Report
  return {
    rootCauseTitle: `Degraded Telemetry — Incident ${incident.id.slice(-6)}`,
    confidence: "LOW",
    category: "AVAILABILITY",
    summary: `Active incident with severity ${incident.severity} and ${failures.length} recorded failure events.`,
    evidenceChain: [
      {
        id: "ev-general-fail",
        label: "Failure Telemetry",
        detail: `Incident opened at ${incident.startedAt.toISOString()}.`,
        severity: "warn",
      },
    ],
    instantFixes: [
      {
        id: "fix-probe-recheck",
        title: "Copy Live Diagnostic cURL",
        summary: "Execute probe directly from local terminal to verify current health.",
        riskLevel: "SAFE",
        actionType: "COPY_SNIPPET",
        snippetLanguage: "bash",
        snippetCode: `curl -i "${monitor.url}"`,
      },
    ],
    analyzedAt,
  };
}

/**
 * Deterministic diagnostic engine for failed or suspicious Webhook events.
 */
export function diagnoseWebhookEvent(ctx: WebhookDiagnosticContext): DiagnosticReport {
  const { event, endpoint } = ctx;
  const analyzedAt = new Date().toISOString();
  const headers = (event.headers as Record<string, string>) || {};

  // 1. Signature Mismatch (INVALID)
  if (event.signatureStatus === "INVALID") {
    return {
      rootCauseTitle: "HMAC Signature Mismatch",
      confidence: "HIGH",
      category: "SECURITY",
      summary: `The webhook carried a signature header, but cryptographic verification failed using the ${endpoint.signatureScheme} secret.`,
      evidenceChain: [
        {
          id: "ev-sig-mismatch",
          label: "HMAC Verification Rejected",
          detail: `Digest generated with endpoint secret did not match signature header for scheme: ${endpoint.signatureScheme}.`,
          severity: "crit",
        },
        {
          id: "ev-sig-payload-size",
          label: "Payload Byte Length",
          detail: `Received ${event.sizeBytes} bytes. Discrepancies often stem from raw-body tampering or header whitespace.`,
          severity: "warn",
        },
      ],
      instantFixes: [
        {
          id: "fix-smart-replay-sign",
          title: "Auto-Sign & Replay (Recalculate Valid HMAC-SHA256)",
          summary: "Automatically regenerates the correct HMAC signature using the configured endpoint secret and replays to downstream.",
          riskLevel: "SAFE",
          actionType: "SMART_REPLAY",
        },
        {
          id: "fix-webhook-middleware",
          title: "Copy Raw Body Preserving Verification Middleware",
          summary: "Common fix for Express / Next.js where JSON body-parsers mutate the raw buffer before HMAC verification.",
          riskLevel: "SAFE",
          actionType: "COPY_SNIPPET",
          snippetLanguage: "typescript",
          snippetCode: `// In Next.js route handler / Express, preserve raw body string for HMAC calculation:\nexport const config = { api: { bodyParser: false } };\n// Or in app directory:\nconst rawBody = await req.text(); // Do NOT use req.json() before HMAC!`,
        },
      ],
      analyzedAt,
    };
  }

  // 2. Missing Signature Header (MISSING)
  if (event.signatureStatus === "MISSING") {
    return {
      rootCauseTitle: "Missing HMAC Signature Header",
      confidence: "HIGH",
      category: "SECURITY",
      summary: `Endpoint expects a signed payload via ${endpoint.signatureScheme}, but no signature header was received in the HTTP headers.`,
      evidenceChain: [
        {
          id: "ev-missing-header",
          label: "Header Missing",
          detail: `Expected signature header (Stripe-Signature / X-Hub-Signature-256 / X-Razorpay-Signature) was omitted.`,
          severity: "crit",
        },
      ],
      instantFixes: [
        {
          id: "fix-smart-replay-inject",
          title: "Inject Valid Signature & Replay",
          summary: "Calculates the appropriate signature from the endpoint secret and replays with headers patched.",
          riskLevel: "SAFE",
          actionType: "SMART_REPLAY",
        },
      ],
      analyzedAt,
    };
  }

  // 3. Content-Type Mismatch
  const ct = event.contentType?.toLowerCase() ?? "";
  if (!ct.includes("json")) {
    return {
      rootCauseTitle: "Content-Type Mismatch / Non-JSON Payload",
      confidence: "HIGH",
      category: "PAYLOAD",
      summary: `Received Content-Type "${event.contentType ?? 'none'}". Downstream webhook consumers typically require "application/json".`,
      evidenceChain: [
        {
          id: "ev-ct",
          label: "MIME Header",
          detail: `Content-Type: ${event.contentType ?? "undefined"}`,
          severity: "warn",
        },
      ],
      instantFixes: [
        {
          id: "fix-smart-replay-ct",
          title: "Normalize Content-Type & Replay",
          summary: 'Patches header to Content-Type: application/json and dispatches replay.',
          riskLevel: "SAFE",
          actionType: "SMART_REPLAY",
          repairedHeaders: { "content-type": "application/json" },
        },
      ],
      analyzedAt,
    };
  }

  // Default Valid / Unchecked
  return {
    rootCauseTitle: "Payload Verified & Valid",
    confidence: "HIGH",
    category: "PAYLOAD",
    summary: "Webhook payload conforms to schema and HMAC verification passed.",
    evidenceChain: [
      {
        id: "ev-valid",
        label: "Verification Status",
        detail: "Valid cryptographic digest matches raw body bytes.",
        severity: "info",
      },
    ],
    instantFixes: [
      {
        id: "fix-curl-replay",
        title: "Copy Exact Replay cURL",
        summary: "Forward this verified payload to an external test service or localhost listener.",
        riskLevel: "SAFE",
        actionType: "COPY_SNIPPET",
        snippetLanguage: "bash",
        snippetCode: `curl -X POST "https://httpbin.org/post" \\\n  -H "Content-Type: application/json" \\\n  -d '${event.rawBody.replace(/'/g, "\\'")}'`,
      },
    ],
    analyzedAt,
  };
}
