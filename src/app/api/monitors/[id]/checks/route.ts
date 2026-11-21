import { handler, json, notFound, readQuery } from "@/lib/api";
import { db } from "@/lib/db";
import { checksQuerySchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/monitors/:id/checks?limit=50&cursor=…&status=failed — cursor-paginated check ledger. */
export const GET = handler(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const { cursor, limit, status } = readQuery(req, checksQuerySchema);

  const exists = await db.monitor.count({ where: { id } });
  if (!exists) throw notFound("Monitor");

  const where = { monitorId: id, ...(status === "ok" ? { ok: true } : status === "failed" ? { ok: false } : {}) };
  const [rows, total] = await Promise.all([
    db.checkRun.findMany({
      where,
      orderBy: [{ checkedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    }),
    db.checkRun.count({ where }),
  ]);

  const hasMore = rows.length > limit;
  const checks = hasMore ? rows.slice(0, limit) : rows;
  return json({ checks, total, nextCursor: hasMore ? checks.at(-1)!.id : null });
});
