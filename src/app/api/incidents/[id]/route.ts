import { handler, json, readJson, throttle, THROTTLE } from "@/lib/api";
import { addOperatorUpdate, ALLOWED_TRANSITIONS, getIncident } from "@/lib/incidents";
import { incidentUpdateSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/incidents/:id — incident, monitor, chronological timeline and allowed next states. */
export const GET = handler(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const incident = await getIncident(id);
  return json({ incident, allowedTransitions: ALLOWED_TRANSITIONS[incident.status] });
});

/**
 * PATCH /api/incidents/:id { status, message? }
 * Forward-only transition (INVESTIGATING → IDENTIFIED → RESOLVED). Resolving
 * stamps `resolvedAt` and computes exact `downtimeSec`.
 */
export const PATCH = handler(async (req: Request, { params }: Ctx) => {
  await throttle(req, "mutate", THROTTLE.mutate);
  const { id } = await params;
  const { status, message } = await readJson(req, incidentUpdateSchema);
  const incident = await addOperatorUpdate(id, { status, message });
  return json({ incident, allowedTransitions: ALLOWED_TRANSITIONS[incident.status] });
});
