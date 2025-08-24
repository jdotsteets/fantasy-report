// app/api/articles/route.ts
import { NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";

const TOPIC_MAP = new Set([
  "rankings",
  "start-sit",
  "advice",
  "dfs",
  "waiver-wire",
  "injury",
]);

async function withRetries<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 300 * i * i));
    }
  }
  throw lastErr;
}

// acceptable SQL param types we use here
type SqlParam = string | number | boolean | null | readonly string[];

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sport = (url.searchParams.get("sport") || "nfl").toLowerCase();
  const topicRaw = url.searchParams.get("topic")?.toLowerCase() || null;
  const topic = topicRaw && TOPIC_MAP.has(topicRaw) ? topicRaw : null;

  const weekParam = url.searchParams.get("week");
  const week = weekParam ? Number(weekParam) : null;

  const days = Number(url.searchParams.get("days") ?? "45");
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "25"), 1), 100);

  const where: string[] = [];
  const params: SqlParam[] = [];

  // sport
  params.push(sport);
  where.push(`a.sport = $${params.length}`);

  // window in days
  params.push(String(days));
  where.push(
    `(a.published_at >= NOW() - ($${params.length} || ' days')::interval
      OR a.discovered_at >= NOW() - ($${params.length} || ' days')::interval)`
  );

  // topic (text[] overlap)
  if (topic) {
    params.push([topic] as const); // readonly string[]
    where.push(`a.topics && $${params.length}::text[]`);
  }

  // week
  if (Number.isFinite(week)) {
    params.push(Number(week!));
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
    return NextResponse.json({ items: result.rows, nextCursor: null }, { status: 200 });
  } catch (e) {
    console.error("[/api/articles] error:", e);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}
