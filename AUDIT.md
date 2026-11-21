# Vigil Codebase Quality & Security Audit

**Audited:** Whole repository (`VIGIL`)  
**Date:** November 21, 2026  
**Auditor:** Senior Engineering Review (Ponytail Quality Audit)  

---

## What this repo does
Vigil is an API uptime monitor, webhook inspector, and incident response platform built with Next.js, PostgreSQL, and Prisma. It runs synthetic HTTP probes, captures and cryptographically verifies webhooks, tracks latency percentiles, and provides guided remediation runbooks.

**Assumed Load:** A production load of 50 to 200 monitors probed every 60 seconds (~5 million check records a month), up to 100 webhook events per minute, and multiple operators using the dashboard at the same time.

---

## 1. Must Fix

### 1. Client IP spoofing bypasses rate limits (`src/lib/api.ts:L102-106`)
- **What this is:** This helper extracts the caller's IP address to enforce rate limits on expensive operations like webhook replays, mutations, and probe sweeps.
- **Problem:** It takes the very first IP in the `X-Forwarded-For` header (`split(",")[0]`). An attacker can send an arbitrary header like `X-Forwarded-For: 1.1.1.1` and rotate it on every request to bypass rate limiting completely.
- **Fix:** On Vercel or reverse-proxy setups, read `x-real-ip` or take the rightmost IP in `x-forwarded-for`.
- **If we skip it:** Anyone can flood the server with unlimited probe sweeps and webhook replays without ever hitting the HTTP 429 throttle.

### 2. Probe sweep endpoint has no authentication (`src/app/api/probe/sweep/route.ts:L18-29`)
- **What this is:** An API endpoint that triggers a full synthetic probe sweep across all active monitors.
- **Problem:** Unlike the cron probe endpoint which requires a `CRON_SECRET`, this route is completely unauthenticated. Combined with IP spoofing, any external visitor can trigger heavy outbound probe sweeps continuously.
- **Fix:** Require an operator secret or cookie session header on `POST /api/probe/sweep` when running in production.
- **If we skip it:** Vigil can be abused as a denial-of-service tool to flood target third-party APIs with outbound probes.

---

## 2. Should Fix

### 3. Monitor URL schema accepts the simulator recovery runbook (`src/lib/validation.ts:L26-28`)
- **What this is:** The URL validation rule for creating or updating synthetic monitors.
- **Problem:** The regex `/^\/api\/sim\/[a-z0-9-]+$/` permits `/api/sim/recover`. If an operator registers a monitor pointing to `/api/sim/recover`, every probe run will silently invoke recovery and reset broken chaos targets to healthy.
- **Fix:** Explicitly forbid `/api/sim/recover` in the regex, or restrict paths to the known mock services (`checkout-api`, `auth-gateway`, `ledger-sync`).
- **If we skip it:** A monitor configured against `/api/sim/recover` defeats chaos simulations by auto-healing them on a loop.

### 4. 30-day raw aggregation slows down overview page loads (`src/lib/metrics.ts:L142-158`)
- **What this is:** The SQL query calculating 24-hour, 7-day, and 30-day uptime and latency percentiles for the dashboard.
- **Problem:** It runs live `count(*)` and `percentile_cont` across all raw check rows over 30 days (`"checkedAt" >= ${d30}`). At 100 monitors checking every minute, this scans over 4 million rows on every overview page refresh.
- **Fix:** Query raw rows only for the 24-hour window, and store daily pre-computed summary rows to compute 7-day and 30-day uptimes.
- **If we skip it:** As the database grows past 100,000 checks, the overview dashboard will take several seconds to load.

### 5. Zero automated test suites exist in the repository (`package.json:L9-22`)
- **What this is:** Project test configuration and regression test scripts.
- **Problem:** There is no test runner (Vitest or Jest) and zero automated test files in the codebase. Core safety logic—such as HMAC signature verification, SSRF host blocking, and incident state transitions—has no test coverage.
- **Fix:** Install Vitest and write focused unit tests for `verifySignature`, `resolveTarget`, and `applyCheckToIncidents`.
- **If we skip it:** Refactoring cryptographic or networking code can introduce quiet security regressions that only surface in production.

### 6. Unawaited background retention pruning in serverless environments (`src/lib/webhooks.ts:L124-142`)
- **What this is:** Background cleanup logic that prunes webhook events older than the 500-event retention limit per endpoint.
- **Problem:** It triggers via `if (Math.random() < 0.05) void pruneEvents(endpoint.id).catch(() => {})`. In serverless environments (like Vercel or AWS Lambda), background tasks freeze the moment the HTTP response completes, meaning cleanup often never finishes.
- **Fix:** Run event retention pruning inside the scheduled cron probe job instead of detached fire-and-forget calls.
- **If we skip it:** Webhook events will accumulate indefinitely in PostgreSQL, exceeding database disk quotas.

---

## 3. Nice to Have

### 7. In-memory rate limiter can drop active buckets (`src/lib/rate-limit.ts:L140-151`)
- **What this is:** In-memory fallback token bucket used when Upstash Redis is not configured.
- **Problem:** When the Map exceeds 10,000 keys, it deletes keys from the start of the iterator. If an inactive client called early and an active client called recently, insertion order can sometimes evict active callers rather than expired ones.
- **Fix:** Prune only keys whose timestamp indicates the bucket has refilled to full capacity (`now - ts > capacity / refillPerSec`).
- **If we skip it:** Under heavy local testing with many unique IP strings, a caller's rate-limit counter might reset earlier than expected.

---

## Summary & Action Plan

- **Verdict:** The core architecture, SSRF pinning, and diagnostic engine are well-designed, but fix IP spoofing and authenticate the probe sweep route first to prevent traffic amplification.
- **Lean:** -40 lines possible by moving background pruning into the cron job and consolidating metric duration helpers.
- **Not checked:** Upstash Redis cluster latency under multi-region failover and real third-party webhook dispatchers (Stripe/GitHub production webhooks).
