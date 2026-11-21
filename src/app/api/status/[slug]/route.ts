import { handler, json, notFound } from "@/lib/api";
import { getStatusPage } from "@/lib/status";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

/** GET /api/status/:slug — public status JSON (30-day daily uptime + dispatches). CDN-cacheable for 30s. */
export const GET = handler(async (_req: Request, { params }: Ctx) => {
  const { slug } = await params;
  const page = await getStatusPage(slug);
  if (!page) throw notFound("Status page");
  return json(page, {
    headers: {
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
      "Access-Control-Allow-Origin": "*",
    },
  });
});
