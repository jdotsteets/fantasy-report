// app/api/articles/route.ts
import { NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";

// Map friendly “topic” query values to what your DB stores.
// Your earlier queries used: rankings, start-sit, advice, dfs, waiver-wire, injury
const TOPIC_MAP = new Set([
  "rankings",
  "start-sit",
  "advice",
  "dfs",
  "waiver-wire",
  "injury",
]);

// Basic retry wrapper (network hiccups / pool timeouts)
async function withRetries<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      // simple backoff
      await new Promise((r) => setTimeout(r, 300 * i * i));
    }
  }
  throw lastErr;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sport = (url.searchParams.get("sport") || "nfl").toLowerCase();
  const topicRaw = url.searchParams.get("topic")?.toLowerCase() || null;
  const topic = topicRaw && TOPIC_MAP.has(topicRaw) ? topicRaw : null;

  const weekParam = url.searchParams.get("week");
  const week = weekParam ? Number(weekParam) : null;

  const days = Number(url.searchParams.get("days") ?? "45");
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "25"), 1), 100);

  // Build SQL safely
  const where: string[] = [];
  const params: any[] = [];

  // sport
  params.push(sport);
  where.push(`a.sport = $${params.length}`);

  // time window (published or discovered within N days)
  params.push(days);
  where.push(
    `(a.published_at >= NOW() - ($${params.length} || ' days')::interval OR a.discovered_at >= NOW() - ($${params.length} || ' days')::interval)`
  );

  // topic via array overlap on a.topics text[] (if present)
  if (topic) {
    params.push([topic]);
    where.push(`a.topics && $${params.length}::text[]`);
  }

  // optional week clamp
  if (Number.isFinite(week)) {
    params.push(week);
    where.push(`a.week = $${params.length}`);
  }

  params.push(limit);

  const sql = `
    SELECT
      a.id,
      COALESCE(a.cleaned_title, a.title) AS title,
      a.url,
      a.canonical_url,
      a.domain,
      a.image_url,
      a.published_at,
      a.discovered_at,
      a.week,
      a.topics,
      s.name AS source,
      COALESCE(a.published_at, a.discovered_at) AS order_ts
    FROM articles a
    JOIN sources s ON s.id = a.source_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY COALESCE(a.published_at, a.discovered_at) DESC NULLS LAST, a.id DESC
    LIMIT $${params.length}
  `;

  try {
    const result = await withRetries(() => dbQuery(sql, params), 3);
    // Shape the payload like your page expects
    return NextResponse.json({ items: result.rows, nextCursor: null }, { status: 200 });
  } catch (e) {
    console.error("[/api/articles] error:", e);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}
