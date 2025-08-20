// app/api/articles/route.ts
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Parameters we allow to pass to pg. Adjust if your db layer exports a type. */
type SQLParam = string | number | boolean | Date | null;

/** Row shape we return (matches the SELECT below). */
type ArticleRow = {
  id: number;
  title: string;
  url: string;
  canonical_url: string | null;
  domain: string | null;
  published_at: string | null;
  week: number | null;
  topics: string[] | null;
  source: string;
};

/** Parse "2025-08-17T10:00:00.000Z|12345" into parts. */
function parseCursor(
  cursor: string | null
): { ts: string; id: number } | null {
  if (!cursor) return null;
  const [ts, idStr] = cursor.split("|");
  if (!ts || !idStr) return null;

  const d = new Date(ts);
  const id = Number(idStr);

  if (!Number.isFinite(id) || id < 0) return null;
  if (Number.isNaN(d.getTime())) return null;

  return { ts: d.toISOString(), id };
}

/** Clamp helper */
function clamp(n: number, min: number, max: number) {
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const topic   = searchParams.get("topic");     // e.g. "waiver-wire"
  const weekRaw = searchParams.get("week");      // e.g. "3"
  const domain  = searchParams.get("domain");    // e.g. "fantasypros.com"
  const source  = searchParams.get("source");    // e.g. "FantasyPros NFL News"
  const limit   = clamp(Number(searchParams.get("limit") ?? "20"), 1, 100);

  const cursorRaw = searchParams.get("cursor");  // e.g. "2025-08-17T10:00:00.000Z|12345"
  const cursor = parseCursor(cursorRaw);

  // Build WHERE and params safely
  const where: string[] = [];
  const params: SQLParam[] = [];
  let p = 1;

  if (topic) {
    // topics is text[]; '$p = any(a.topics)' matches if topic exists in array
    where.push(`$${p} = any(a.topics)`);
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
    where.push(`a.domain = $${p}`);
    params.push(domain);
    p++;
  }

  if (source) {
    where.push(`s.name = $${p}`);
    params.push(source);
    p++;
  }

  if (cursor) {
    // Keyset: (published_at, id) < (cursor.ts, cursor.id)
    // Use explicit casts to match types.
    where.push(`(a.published_at, a.id) < ($${p}::timestamptz, $${p + 1}::int)`);
    params.push(cursor.ts, cursor.id);
    p += 2;
  }

  const whereSql = where.length ? `where ${where.join(" and ")}` : "";

  const sql = `
    select
      a.id,
      coalesce(a.cleaned_title, a.title) as title,
      a.url,
      a.canonical_url,
      a.domain,
      a.published_at,
      a.week,
      a.topics,
      s.name as source
    from articles a
    join sources s on s.id = a.source_id
    ${whereSql}
    order by a.published_at desc nulls last, a.id desc
    limit $${p}
  `;
  params.push(limit);

  const { rows } = await query(sql, params);
  const items = rows as ArticleRow[];

  // Prepare next cursor (keyset) if we returned a full page.
  let nextCursor: string | null = null;
  if (items.length === limit) {
    const last = items[items.length - 1];
    if (last?.published_at && Number.isFinite(last.id)) {
      nextCursor = `${new Date(last.published_at).toISOString()}|${last.id}`;
    }
  }

  return new Response(
    JSON.stringify({ items, nextCursor }),
    { headers: { "content-type": "application/json" } }
  );
}
