# Vigil

**API uptime monitoring, webhook inspection & replay, and live incident telemetry — in one Next.js app.**

Vigil probes your HTTP endpoints from the server, records exact round-trip latency, computes rolling uptime and p50/p95/p99, and runs an incident state machine that opens an incident after three consecutive failures and resolves it after two consecutive successes. It also captures webhooks on unique ingest URLs (rate-limited and HMAC-verified), lets you inspect and replay them to any public URL, and publishes a print-clean public status page.

Everything ships as a single Next.js App Router codebase: no Docker, no queue, no worker daemon. Deploy it to Vercel with a Neon Postgres database.

---

## Try it in 60 seconds

Open the console and use the **Simulator** dock in the bottom-right corner:

1. **Run probe sweep.** Probes every active monitor immediately and animates the fresh latencies.
2. **Toggle service chaos.** Flip the built-in `/api/sim/checkout-api` between *Healthy* (≈45 ms), *Latency spike* (≈680 ms) and *Outage* (503). Press **×3** in outage mode and watch Checkout API go Degraded → Down → incident opened. Switch back to Healthy and press **×3** again to see it auto-resolve with exact downtime.
3. **Fire sample webhook.** Sends a signed Stripe `payment_intent.succeeded`, GitHub `pull_request.opened` or Razorpay `order.paid` payload through the real ingest path. Open **Webhooks** to inspect it, then use **Edit & replay**.

The public status page lives at **`/status/vigil`**.

---

## Features

| Area | What it does |
| --- | --- |
| **Synthetic monitoring** | Per-monitor method, expected status, timeout, interval, degraded-latency threshold and optional body-contains assertion. Latency is measured with `performance.now()` from dispatch until the (capped) body is read. Uptime and p50/p95/p99 are computed in Postgres with `percentile_cont`. |
| **Incident state machine** | `INVESTIGATING → IDENTIFIED → RESOLVED`, forward-only. Opens automatically after 3 consecutive failures; auto-resolves after 2 consecutive successes, recording `downtimeSec` from the first failure of the streak. Operators post timeline notes and advance state. |
| **Webhook inspector** | Unique `/api/ingest/:token` endpoints accept POST/PUT/PATCH. Each request passes a token-bucket rate limiter (`429` + `Retry-After`), a 512 KB size cap and HMAC-SHA256 verification (Stripe, GitHub, Razorpay or generic schemes). Vigil stores headers (credentials redacted), query, source IP, size, and raw and parsed body. |
| **Replay engine** | Forward the original bytes, or an edited body, to any public URL with header overrides and optional re-signing. Shows the live status, latency and body. Every attempt is logged, including blocked ones. |
| **Public status page** | `/status/[slug]`: 30-day segmented uptime bars per component with hover detail, active incidents, and chronological dispatches in UTC. Cached for 30 s, and prints cleanly. |
| **Live telemetry** | While a dashboard tab is open, a client-side engine calls `POST /api/probe/sweep {scope:"due"}` every 8 s. The server leases due monitors atomically, so any number of open tabs probe each monitor only once per interval. |

### Security model

- **SSRF protection** ([`src/lib/ssrf.ts`](src/lib/ssrf.ts)). Every probe and replay target is checked for scheme, embedded credentials, port, blocked hostnames (`localhost`, `*.internal`, metadata hosts) and IP literals. All A/AAAA records are resolved and must be public: loopback, RFC 1918, CGNAT, link-local / `169.254.169.254`, ULA and IPv4-mapped forms are all rejected. A pinned undici dispatcher re-validates the address at connect time, which closes the DNS-rebinding gap, and redirects are never followed. Vigil's own `/api/sim/*` endpoints are the only internal exception. That allowance is anchored to `APP_URL`, never to the request's `Host` header.
- **Rate limiting** ([`src/lib/rate-limit.ts`](src/lib/rate-limit.ts)). A token bucket runs as a single atomic Lua script on Upstash Redis when it's configured. Otherwise it uses an in-memory bucket, which is also the fail-open fallback if Redis is unreachable. Expensive operator actions (probes, replays, edits) are throttled per IP.
- **Webhook secrets** are returned in full only once, at creation or rotation. Signatures are compared in constant time, and Stripe signatures enforce a 5-minute timestamp tolerance.
- **Cron** requires `Authorization: Bearer $CRON_SECRET`, compared in constant time.
- **Operator sign-in** ([`src/middleware.ts`](src/middleware.ts)). With `VIGIL_OPERATOR_SECRET` set, every console page and API needs a signed session cookie (from `/unlock`) or the secret as a Bearer / `x-operator-secret` header. Signed-out pages redirect to `/unlock`; APIs return 401. Only the status page, webhook ingest, the read-only `/api/sim/*` demo services and cron stay public. Production refuses to serve the console without the secret; local dev without it stays open.

---

## Tech stack

Next.js 15 (App Router, TypeScript strict) · React 19 · Tailwind CSS · Framer Motion · Recharts · Lucide · Prisma 6 + PostgreSQL · Zod · undici · Upstash Redis (optional)

---

## Run locally

**Requirements:** Node.js ≥ 20.11 and a PostgreSQL database. A free [Neon](https://neon.tech) project works; so does a local Postgres.

```bash
git clone <your-fork-url> vigil && cd vigil
npm install                     # also runs `prisma generate`
cp .env.example .env            # Windows PowerShell: Copy-Item .env.example .env
```

Edit `.env`:

```bash
DATABASE_URL="postgresql://…"   # Neon: the pooled connection string
DIRECT_URL="postgresql://…"     # Neon: the direct connection string (local Postgres: same as above)
APP_URL="http://localhost:3000" # must match the port you run on
CRON_SECRET="any-long-random-string"
```

Create the schema, load demo data and start:

```bash
npx prisma db push              # create tables
npx prisma db seed              # 7 monitors, ~11k checks over 30 days, incidents, webhooks
npm run dev                     # http://localhost:3000
```

The seed prints a summary like `✔ Seeded 7 monitors · 10,943 checks · 6 incidents · 21 webhook events · 4 replays`. Re-running it wipes and recreates the demo data.

> If port 3000 is busy, run `npx next dev -p 3001` and set `APP_URL="http://localhost:3001"`. The internal `/api/sim/*` demo monitors resolve against `APP_URL`.

### Useful scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build (runs `prisma generate` first) / serve it |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:push` | Sync the Prisma schema to the database |
| `npm run db:seed` | Reload demo data |
| `npm run db:reset` | Drop everything, re-push and re-seed |
| `npm run db:migrate` | Create versioned migrations (recommended once a team shares the database) |
| `npm run db:studio` | Browse data in Prisma Studio |

---

## Deploy to Vercel + Neon

1. **Create the database.** In [Neon](https://console.neon.tech), create a project and copy two connection strings from the dashboard: the **pooled** one (host contains `-pooler`) and the **direct** one.

2. **Create the schema and demo data** from your machine, pointing at Neon:

   ```bash
   DATABASE_URL="<pooled>" DIRECT_URL="<direct>" npx prisma db push
   DATABASE_URL="<pooled>" DIRECT_URL="<direct>" npx prisma db seed
   ```

   On Windows PowerShell, put both values in `.env` temporarily instead.

3. **Import the repository** at [vercel.com/new](https://vercel.com/new). The framework preset is detected automatically.

4. **Add environment variables** (Project → Settings → Environment Variables):

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | Neon pooled connection string |
   | `DIRECT_URL` | Neon direct connection string |
   | `CRON_SECRET` | A long random string (`openssl rand -hex 32`) |
   | `VIGIL_OPERATOR_SECRET` | Another long random string: the password for the console at `/unlock` |
   | `ALERT_WEBHOOK_URL` | *(optional)* Slack or Discord incoming-webhook URL, pinged when an incident opens or resolves |
   | `CHECK_RETENTION_DAYS` | *(optional, default 35, min 31)* Days of raw check history kept; older checks are pruned by cron |
   | `APP_URL` | Your production URL, e.g. `https://vigil-yourname.vercel.app` *(optional on Vercel, which falls back to the production domain)* |
   | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | *(optional)* From an [Upstash](https://console.upstash.com) Redis database, for a rate limit shared across all serverless instances |

5. **Deploy.** The build runs `prisma generate && next build`. Then open `/` and `/status/vigil`.

> The Neon integration in the Vercel marketplace can create the database and set `DATABASE_URL` for you. You still need to add `DIRECT_URL` and run step 2.

### Scheduled probing

Vigil probes in three ways, and you can combine them:

- **Live polling.** Automatic whenever someone has the dashboard open.
- **Vercel Cron.** [`vercel.json`](vercel.json) calls `/api/cron/probe` once a day, because the Hobby plan only allows daily cron jobs and rejects deployments with more frequent schedules. On Pro, change the schedule to `*/5 * * * *`.
- **GitHub Actions (free, every ~5 minutes).** [`.github/workflows/probe.yml`](.github/workflows/probe.yml) calls the same endpoint. Add repository secrets `VIGIL_URL` and `CRON_SECRET` to enable it; without them it skips.

Each cron run leases due monitors in batches until it has used about 45 s, so overlapping triggers never double-probe a monitor.

---

## API reference

All endpoints return JSON. Errors use `{ "error": { "code", "message", "details?" } }`. Request bodies are validated with Zod; validation failures return `400` with per-field details, and SSRF rejections return `422`.

| Method & path | Description |
| --- | --- |
| `GET /api/overview?range=1H\|24H\|7D\|30D` | KPIs, fleet latency series, monitor registry, recent incidents |
| `GET` · `POST /api/monitors` | List with rolling stats and sparklines · create (target validated, first probe run) |
| `GET` · `PATCH` · `DELETE /api/monitors/:id` | Detail with range stats, series, status codes and incidents · edit / pause · delete |
| `POST /api/monitors/:id/probe` | Manual probe |
| `GET /api/monitors/:id/checks?cursor=&limit=&status=all\|ok\|failed` | Cursor-paginated check ledger |
| `POST /api/probe/sweep` `{scope:"due"\|"all"}` | Live polling ("due") or probe everything now ("all") |
| `GET /api/cron/probe` | Scheduled probing (`Authorization: Bearer $CRON_SECRET`) |
| `POST` · `PUT` · `PATCH /api/ingest/:token` | Webhook capture (rate-limited, HMAC-verified). Responds `202` with `X-RateLimit-*` headers |
| `GET` · `POST /api/webhooks` | Capture endpoints · create (secret returned once) |
| `GET` · `PATCH` · `DELETE /api/webhooks/endpoints/:id` | Endpoint with rate-limit meter · rename / change scheme / rotate secret · delete |
| `GET /api/webhooks/endpoints/:id/events?after=&cursor=` | Live stream (`after`) or older pages (`cursor`) |
| `GET` · `DELETE /api/webhooks/:eventId` | Full captured event with replay log · delete |
| `POST /api/webhooks/:eventId/replay` | `{targetUrl, method?, body?, headers?, resign?}` |
| `GET /api/incidents?status=active\|resolved\|all&monitorId=` | Incidents with timelines and counts |
| `GET` · `PATCH /api/incidents/:id` | Detail and allowed transitions · `{status, message?}` |
| `POST /api/incidents/:id/updates` | Operator note `{message, status?}` |
| `GET /api/status/:slug` | Public status JSON (CORS-enabled, CDN-cached for 30 s) |
| `ANY /api/sim/:service` | Built-in mock services: `checkout-api`, `auth-gateway`, `ledger-sync` |
| `GET` · `PATCH /api/simulator` | Mock service modes · `{service, mode:"HEALTHY"\|"LATENCY"\|"OUTAGE"}` |
| `POST /api/simulator/webhook` | `{provider:"stripe"\|"github"\|"razorpay", endpointId?}` |

**Try the ingest endpoint with curl.** Copy an ingest URL from the Webhooks page:

```bash
curl -i -X POST "http://localhost:3000/api/ingest/<token>" \
  -H "content-type: application/json" \
  -d '{"type":"invoice.paid","amount":4200}'
```

---

## Project structure

```
prisma/
  schema.prisma         Monitor, CheckRun, Incident(+Update), WebhookEndpoint/Event/Replay, StatusPage, SimService
  seed.ts               Deterministic 30-day telemetry, incidents derived by replaying the real state machine
src/
  app/
    (console)/          Overview, Monitors, Monitor detail, Webhooks, Incidents (inside the app shell)
    status/[slug]/      Public status page (standalone, ISR 30 s)
    api/                Route handlers (thin; logic lives in src/lib)
  components/
    shell/              AppShell (top bar, rail, mobile nav), SimulatorDock
    providers/          TelemetryProvider: live polling engine, heartbeat pulses, refresh signal
    charts/             LatencyChart (p50/p95/p99), UptimeBarStrip
    monitors/ webhooks/ incidents/ ui/
  lib/
    probe.ts            Probe execution, advisory-locked persistence, atomic due-monitor leasing
    incidents.ts        State machine transitions and operator actions
    metrics.ts          Dashboard read models (SQL percentiles)
    ssrf.ts             SSRF validation and DNS-pinned fetch
    rate-limit.ts       Token bucket (Upstash Lua / in-memory)
    hmac.ts             Provider signature signing and verification
    stats.ts            Pure telemetry maths (client-safe)
    motion.ts           Shared easing, springs and variants (reduced-motion aware)
```

---

## Design notes

- **Consistency without a worker.** Each monitor's check insert, incident transition and status rollup run in one transaction under `pg_advisory_xact_lock(hashtext(monitorId))`. Due monitors are leased with `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)`, so cron, sweeps and many open dashboards can't double-probe a monitor or open duplicate incidents.
- **Time-zone independence.** Raw SQL time windows are built from epoch milliseconds `AT TIME ZONE 'UTC'` ([`src/lib/sql.ts`](src/lib/sql.ts)), so results don't depend on the database session's `TimeZone`.
- **Latency semantics.** Percentiles only include checks that received an HTTP response. Timeouts count against uptime, not latency.
- **Demo state in Postgres.** The simulator's chaos modes live in the `SimService` table, so every serverless instance agrees on them.

## License

MIT
