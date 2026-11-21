/**
 * Realistic provider webhook payloads used by the seed script and the
 * "Fire Sample Webhook" action in the simulator dock.
 * Shapes follow each provider's public documentation (trimmed to the fields
 * people actually inspect).
 */

export const SAMPLE_PROVIDERS = ["stripe", "github", "razorpay"] as const;
export type SampleProvider = (typeof SAMPLE_PROVIDERS)[number];

export interface SamplePayload {
  provider: SampleProvider;
  eventType: string;
  body: Record<string, unknown>;
  /** Provider-specific non-signature headers. */
  headers: Record<string, string>;
  userAgent: string;
}

type Rng = () => number;

const ALPHANUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const HEX = "0123456789abcdef";

function randomString(rng: Rng, length: number, alphabet = ALPHANUM): string {
  let s = "";
  for (let i = 0; i < length; i++) s += alphabet[Math.floor(rng() * alphabet.length)];
  return s;
}

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!;
}

function uuid(rng: Rng): string {
  const h = (n: number) => randomString(rng, n, HEX);
  return `${h(8)}-${h(4)}-4${h(3)}-${pick(rng, ["8", "9", "a", "b"])}${h(3)}-${h(12)}`;
}

const CUSTOMERS = [
  { name: "Amara Okafor", email: "amara@northwind.dev" },
  { name: "Lukas Brandt", email: "lukas@halcyon.io" },
  { name: "Priya Raman", email: "priya@ledgerline.in" },
  { name: "Mateo Alvarez", email: "mateo@cobalt.studio" },
  { name: "Hana Sato", email: "hana@kiri.app" },
];

export function stripePayload(rng: Rng = Math.random, atSec = Math.floor(Date.now() / 1000)): SamplePayload {
  const amount = pick(rng, [1900, 4900, 12900, 29900, 7500, 2499]);
  const customer = pick(rng, CUSTOMERS);
  const pi = `pi_3${randomString(rng, 23)}`;
  return {
    provider: "stripe",
    eventType: "payment_intent.succeeded",
    userAgent: "Stripe/1.0 (+https://stripe.com/docs/webhooks)",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: {
      id: `evt_3${randomString(rng, 23)}`,
      object: "event",
      api_version: "2024-06-20",
      created: atSec,
      type: "payment_intent.succeeded",
      livemode: false,
      pending_webhooks: 1,
      request: { id: `req_${randomString(rng, 14)}`, idempotency_key: uuid(rng) },
      data: {
        object: {
          id: pi,
          object: "payment_intent",
          amount,
          amount_received: amount,
          currency: "usd",
          status: "succeeded",
          capture_method: "automatic",
          customer: `cus_${randomString(rng, 14)}`,
          description: `Vigil Pro — ${pick(rng, ["monthly", "annual"])} plan`,
          latest_charge: `ch_3${randomString(rng, 23)}`,
          payment_method_types: ["card"],
          receipt_email: customer.email,
          metadata: { order_id: `ord_${randomString(rng, 10, HEX)}`, workspace: "vigil-demo" },
          created: atSec - 2,
        },
      },
    },
  };
}

export function githubPayload(rng: Rng = Math.random, atSec = Math.floor(Date.now() / 1000)): SamplePayload {
  const number = 100 + Math.floor(rng() * 900);
  const title = pick(rng, [
    "perf: cache resolved DNS records for probe workers",
    "fix(ingest): reject oversized payloads before parsing",
    "feat(status): print stylesheet for public status page",
    "chore: bump undici to 7.x",
    "refactor(incidents): extract state machine transitions",
  ]);
  const login = pick(rng, ["amara-ok", "lbrandt", "priya-r", "mateo-a", "hsato"]);
  const iso = new Date(atSec * 1000).toISOString();
  return {
    provider: "github",
    eventType: "pull_request.opened",
    userAgent: `GitHub-Hookshot/${randomString(rng, 7, HEX)}`,
    headers: {
      "content-type": "application/json",
      "x-github-event": "pull_request",
      "x-github-delivery": uuid(rng),
      "x-github-hook-id": String(400_000_000 + Math.floor(rng() * 9_999_999)),
    },
    body: {
      action: "opened",
      number,
      pull_request: {
        id: 2_000_000_000 + Math.floor(rng() * 99_999_999),
        number,
        state: "open",
        title,
        draft: false,
        html_url: `https://github.com/vigil-labs/vigil/pull/${number}`,
        user: { login, id: 10_000_000 + Math.floor(rng() * 9_999_999), type: "User" },
        head: { ref: title.split(":")[0]!.replace(/[()]/g, "-").replace(/-$/, ""), sha: randomString(rng, 40, HEX) },
        base: { ref: "main", sha: randomString(rng, 40, HEX) },
        additions: Math.floor(rng() * 400),
        deletions: Math.floor(rng() * 120),
        changed_files: 1 + Math.floor(rng() * 14),
        created_at: iso,
        updated_at: iso,
      },
      repository: {
        id: 812_345_678,
        name: "vigil",
        full_name: "vigil-labs/vigil",
        private: false,
        default_branch: "main",
      },
      sender: { login, type: "User" },
    },
  };
}

export function razorpayPayload(rng: Rng = Math.random, atSec = Math.floor(Date.now() / 1000)): SamplePayload {
  const amount = pick(rng, [49900, 129900, 249900, 89900]);
  const orderId = `order_${randomString(rng, 14)}`;
  const customer = pick(rng, CUSTOMERS);
  return {
    provider: "razorpay",
    eventType: "order.paid",
    userAgent: "Razorpay-Webhook/v1",
    headers: {
      "content-type": "application/json",
      "x-razorpay-event-id": `${randomString(rng, 14)}`,
    },
    body: {
      entity: "event",
      account_id: `acc_${randomString(rng, 14)}`,
      event: "order.paid",
      contains: ["payment", "order"],
      created_at: atSec,
      payload: {
        payment: {
          entity: {
            id: `pay_${randomString(rng, 14)}`,
            entity: "payment",
            amount,
            currency: "INR",
            status: "captured",
            order_id: orderId,
            method: pick(rng, ["upi", "card", "netbanking"]),
            captured: true,
            email: customer.email,
            contact: `+9198${Math.floor(10_000_000 + rng() * 89_999_999)}`,
            fee: Math.round(amount * 0.02),
            tax: Math.round(amount * 0.0036),
            created_at: atSec - 3,
          },
        },
        order: {
          entity: {
            id: orderId,
            entity: "order",
            amount,
            amount_paid: amount,
            amount_due: 0,
            currency: "INR",
            receipt: `rcpt_${Math.floor(rng() * 100_000)}`,
            status: "paid",
            attempts: 1,
            created_at: atSec - 40,
          },
        },
      },
    },
  };
}

export function samplePayload(provider: SampleProvider, rng: Rng = Math.random, atSec?: number): SamplePayload {
  switch (provider) {
    case "stripe":
      return stripePayload(rng, atSec);
    case "github":
      return githubPayload(rng, atSec);
    case "razorpay":
      return razorpayPayload(rng, atSec);
  }
}

/** Best-effort provider event name from headers + parsed body, for the inspector list. */
export function detectEventType(headers: Headers | Record<string, string>, json: unknown): string | null {
  const get = (k: string) =>
    typeof (headers as Headers).get === "function"
      ? (headers as Headers).get(k)
      : ((headers as Record<string, string>)[k] ?? null);

  const ghEvent = get("x-github-event");
  if (ghEvent) {
    const action = json && typeof json === "object" && "action" in json ? String((json as { action: unknown }).action) : null;
    return action ? `${ghEvent}.${action}` : ghEvent;
  }
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    if (typeof o.type === "string") return o.type; // Stripe & most "event envelope" providers
    if (typeof o.event === "string") return o.event; // Razorpay
    if (typeof o.event_type === "string") return o.event_type;
  }
  return null;
}
