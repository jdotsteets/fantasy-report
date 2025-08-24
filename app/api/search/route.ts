// app/api/search/route.ts
import { dbQuery } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = {
  id: number;
  title: string;
  url: string;
  canonical_url: string | null;
  domain: string | null;
  image_url: string | null;          // 👈 ADD
  published_at: string | null;
  source: string;

};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  const limit = Math.min(Number(searchParams.get("limit") || "25"), 100);

  if (!q) {
    return new Response(JSON.stringify({ items: [] }), { headers: { "content-type": "application/json" } });
  }

  // heuristic: for very short queries, also try ILIKE
  const sql = `
    WITH needle AS (
      SELECT websearch_to_tsquery('english', $1) AS tsq
    )
    SELECT
      a.id,
      COALESCE(a.cleaned_title, a.title) AS title,
      a.url,
      a.canonical_url,
      a.domain,
      a.published_at,
      a.image_url,
      s.name AS source,
      ts_rank(a.tsv, (SELECT tsq FROM needle)) AS rank
    FROM articles a
    JOIN sources s ON s.id = a.source_id
    WHERE (
      a.tsv @@ (SELECT tsq FROM needle)
      OR ($2::boolean AND (
          a.title ILIKE '%' || $1 || '%'
       OR a.cleaned_title ILIKE '%' || $1 || '%'
      ))
    )
    ORDER BY rank DESC NULLS LAST, a.published_at DESC NULLS LAST, a.id DESC
    LIMIT $3
  `;

  // turn on ILIKE fallback if query < 3 chars (e.g., "AJ")
  const useIlike = q.length < 3;

  const { rows } = await dbQuery<Row>(sql, [q, useIlike, limit]);

  return new Response(JSON.stringify({ items: rows }), {
    headers: { "content-type": "application/json" },
  });
}
