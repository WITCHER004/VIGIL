import { handler, json, readQuery } from "@/lib/api";
import { listIncidents } from "@/lib/incidents";
import { incidentsQuerySchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** GET /api/incidents?status=active|resolved|all&monitorId=… — incidents with full timelines + counts. */
export const GET = handler(async (req: Request) => {
  const query = readQuery(req, incidentsQuerySchema);
  return json(await listIncidents(query));
});
