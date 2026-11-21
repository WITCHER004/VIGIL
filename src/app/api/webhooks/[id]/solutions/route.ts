import { handler, json, notFound } from "@/lib/api";
import { db } from "@/lib/db";
import { diagnoseWebhookEvent } from "@/lib/diagnostics";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/webhooks/:id/solutions
 * Computes deterministic DiagnosticReport for a captured webhook event.
 */
export const GET = handler(async (req: Request, { params }: Ctx) => {
  const { id } = await params;

  const event = await db.webhookEvent.findUnique({
    where: { id },
    include: {
      endpoint: true,
      remediations: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!event) throw notFound("Webhook event");

  const report = diagnoseWebhookEvent({
    event,
    endpoint: event.endpoint,
  });

  return json({
    report,
    remediations: event.remediations,
  });
});
