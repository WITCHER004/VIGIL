import { handler, json, notFound } from "@/lib/api";
import { db } from "@/lib/db";
import { generateIncidentPostmortem } from "@/lib/memory";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/incidents/:id/postmortem
 * Generates an executive Markdown Incident Report with timeline, diagnostic evidence,
 * and audited remediation runbooks.
 */
export const POST = handler(async (req: Request, { params }: Ctx) => {
  const { id } = await params;

  const incident = await db.incident.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!incident) throw notFound("Incident");

  const postmortem = await generateIncidentPostmortem(id);

  return json({
    ok: true,
    markdown: postmortem.markdown,
    filename: postmortem.filename,
    generatedAt: new Date().toISOString(),
  });
});
