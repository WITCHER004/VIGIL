import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { WebhookInspector } from "@/components/webhooks/WebhookInspector";
import { INGEST_BUCKET } from "@/lib/rate-limit";
import { MAX_INGEST_BYTES } from "@/lib/webhooks";

export const metadata: Metadata = { title: "Webhooks" };

/** Webhook inspector — capture, verify (HMAC-SHA256), inspect and replay. */
export default function WebhooksPage() {
  return (
    <div className="mx-auto max-w-[1520px]">
      <PageHeader
        eyebrow="Webhook inspector"
        title="Webhooks"
        description={`Point any provider at an ingest URL. Requests pass a token-bucket rate limiter (${INGEST_BUCKET.capacity} burst, +${INGEST_BUCKET.refillPerSec}/s), a ${MAX_INGEST_BYTES / 1024} KB size cap and HMAC-SHA256 verification before headers, query, source IP and raw body are stored for inspection and replay.`}
      />
      <WebhookInspector className="mt-8 lg:h-[calc(100dvh-var(--topbar-h)-3rem)] lg:min-h-[700px]" />
    </div>
  );
}
