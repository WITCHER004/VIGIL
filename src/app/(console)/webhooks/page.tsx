import type { Metadata } from "next";
import { Suspense } from "react";
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
        description={`Point any provider at an ingest URL. Each request is rate limited (${INGEST_BUCKET.capacity} burst, +${INGEST_BUCKET.refillPerSec}/s), capped at ${MAX_INGEST_BYTES / 1024} KB and HMAC-verified, then kept for inspection and replay.`}
      />
      <div className="mt-8">
        {/* The inspector reads ?new=1 via useSearchParams, which needs a Suspense boundary on a static page. */}
        <Suspense fallback={<div className="panel h-[700px] animate-pulse bg-well/60" aria-hidden />}>
          <WebhookInspector className="lg:h-[calc(100dvh-var(--topbar-h)-3rem)] lg:min-h-[700px]" />
        </Suspense>
      </div>
    </div>
  );
}
