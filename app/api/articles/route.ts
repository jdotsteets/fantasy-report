// app/api/articles/route.ts
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseCursor(cursor: string | null): { ts: string; id: number } | null {
  if (!cursor) return null;
  const [ts, idStr] = cursor.split("|");
  const id = Number(idStr);
  if (!ts || !Number.isFinite(id)) return null;
  return { ts, id };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const topic = searchParams.get("topic");        // e.g. "waiver-wire"
  const week = searchParams.get("week");          // e.g. "3"
  const domain = searchParams.get("domain");      // e.g. "fantasypros.com"
  const source = searchParams.get("source");      // e.g. "FantasyPros NFL News"
  const limit = Math.min(Math.max(Number(searchParams.get("limit") || 20), 1), 100);
  const cursorRaw = searchParams.get("cursor");   // e.g. "2025-08-17T10:00:00.000Z|12345"
  const cursor = parseCursor(cursorRaw);

  // Build WHERE dynamically
  const where: string[] = [];
  const params: any[] = [];
  let p = 1;

  if (topic) {
    where.push(`$${p} = any(a.topics)`); params.push(topic); p++;
  }
  if (week) {
    where.push(`a.week = $${p}`); params.push(Number(week)); p++;
  }
  if (domain) {
    where.push(`a.domain = $${p}`); params.push(domain); p++;
  }
  if (source) {
    where.push(`s.name = $${p}`); params.push(source); p++;
  }
  if (cursor) {
    // keyset: (published_at,id) < (cursor.ts, cursor.id)
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

  // next cursor (if we hit the page size)
  let nextCursor: string | null = null;
  if (rows.length === limit) {
    const last = rows[rows.length - 1] as { published_at: string; id: number };
    if (last?.published_at && last?.id) {
      nextCursor = `${new Date(last.published_at).toISOString()}|${last.id}`;
    }
  }

  return new Response(
    JSON.stringify({ items: rows, nextCursor }),
    { headers: { "content-type": "application/json" } }
  );
}
