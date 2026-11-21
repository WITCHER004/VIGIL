import { handler, json, readJson, throttle, THROTTLE } from "@/lib/api";
import { addOperatorUpdate, ALLOWED_TRANSITIONS } from "@/lib/incidents";
import { incidentNoteSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/incidents/:id/updates { message, status? } — operator timeline note. */
export const POST = handler(async (req: Request, { params }: Ctx) => {
  await throttle(req, "mutate", THROTTLE.mutate);
  const { id } = await params;
  const { message, status } = await readJson(req, incidentNoteSchema);
  const incident = await addOperatorUpdate(id, { message, status });
  return json({ incident, allowedTransitions: ALLOWED_TRANSITIONS[incident.status] }, { status: 201 });
});
