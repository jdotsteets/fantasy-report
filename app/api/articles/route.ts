// app/api/articles/route.ts
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SQLParam = string | number | boolean | Date | null;

type ArticleRow = {
  id: number;
  title: string;
  url: string;
  canonical_url: string | null;
  domain: string | null;
  published_at: string | null;
  created_at: string | null;      // include if you have it
  week: number | null;
  topics: string[] | null;
  source: string;
  order_ts: string | null;        // derived for ordering/pagination
};

function parseCursor(cursor: string | null): { ts: string; id: number } | null {
  if (!cursor) return null;
  const [ts, idStr] = cursor.split("|");
  const d = new Date(ts);
  const id = Number(idStr);
  if (!Number.isFinite(id) || Number.isNaN(d.getTime())) return null;
  return { ts: d.toISOString(), id };
}

function clamp(n: number, min: number, max: number) {
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const topic   = searchParams.get("topic");
  const weekRaw = searchParams.get("week");
  const domain  = searchParams.get("domain");
  const source  = searchParams.get("source");
  const limit   = clamp(Number(searchParams.get("limit") ?? "20"), 1, 100);

  const cursor = parseCursor(searchParams.get("cursor"));

  const where: string[] = [];
  const params: SQLParam[] = [];
  let p = 1;

  // topics is text[]; guard for NULL
  if (topic) {
    where.push(`a.topics IS NOT NULL AND $${p} = ANY(a.topics)`);
    params.push(topic);
    p++;
  }

  if (weekRaw) {
    const weekNum = Number(weekRaw);
    if (Number.isFinite(weekNum)) {
      where.push(`a.week = $${p}`);
      params.push(weekNum);
      p++;
    }
  }

  if (domain) {
    // case-insensitive match; switch to '=' if you prefer exact
    where.push(`a.domain ILIKE $${p}`);
    params.push(domain);
    p++;
  }

  if (source) {
    where.push(`s.name = $${p}`);
    params.push(source);
    p++;
  }

  // We order by order_ts := COALESCE(published_at, created_at) DESC, id DESC
  // For correct keyset pagination with DESC, use tuple < (cursor_ts, cursor_id)
  if (cursor) {
    where.push(`(COALESCE(a.published_at, a.created_at), a.id) < ($${p}::timestamptz, $${p + 1}::int)`);
    params.push(cursor.ts, cursor.id);
    p += 2;
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const sql = `
    SELECT
      a.id,
      COALESCE(a.cleaned_title, a.title) AS title,
      a.url,
      a.canonical_url,
      a.domain,
      a.published_at,
      a.created_at,
      a.week,
      a.topics,
      s.name AS source,
      COALESCE(a.published_at, a.created_at) AS order_ts
    FROM articles a
    JOIN sources s ON s.id = a.source_id
    ${whereSql}
    ORDER BY COALESCE(a.published_at, a.created_at) DESC NULLS LAST, a.id DESC
    LIMIT $${p}
  `;
  params.push(limit);

  const { rows } = await query(sql, params);
  const items = rows as ArticleRow[];

  let nextCursor: string | null = null;
  if (items.length === limit) {
    const last = items[items.length - 1];
    if (last?.order_ts && Number.isFinite(last.id)) {
      nextCursor = `${new Date(last.order_ts).toISOString()}|${last.id}`;
    }
  }

  return new Response(JSON.stringify({ items, nextCursor }), {
    headers: { "content-type": "application/json" },
  });
}
