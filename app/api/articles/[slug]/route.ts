// app/api/articles/[slug]/route.ts
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ArticleRow = {
  id: number;
  title: string;
  url: string;
  canonical_url: string | null;
  domain: string | null;
  image_url: string | null;
  published_at: string | null;
  week: number | null;
  topics: string[] | null;
  source: string;
};

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ slug: string }> } // 👈 params is a Promise
) {
  const { slug } = await ctx.params;        // 👈 await it
  if (!slug) return new Response("Missing slug", { status: 400 });

  const { rows } = await query<ArticleRow>(
    `
      SELECT
        a.id,
        COALESCE(a.cleaned_title, a.title) AS title,
        a.url,
        a.canonical_url,
        a.domain,
        a.image_url,                    -- ✅ keep image_url
        a.published_at,
        a.week,
        a.topics,
        s.name AS source
      FROM articles a
      JOIN sources s ON s.id = a.source_id
      WHERE a.slug = $1
      LIMIT 1
    `,
    [slug]
  );

  if (rows.length === 0) return new Response("Not found", { status: 404 });

  return new Response(JSON.stringify(rows[0]), {
    headers: { "content-type": "application/json" },
  });
}
