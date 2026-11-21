import { handler, json, readQuery } from "@/lib/api";
import { getOverview } from "@/lib/metrics";
import { rangeQuerySchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** GET /api/overview?range=24H — KPIs, fleet latency series, monitor registry and recent dispatches. */
export const GET = handler(async (req: Request) => {
  const { range } = readQuery(req, rangeQuerySchema);
  return json(await getOverview(range));
});
