// app/api/articles/route.ts
import { NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";

export const preferredRegion = ["iad1"]; // keep close to us-east
export const runtime = "nodejs";

// ---- tiny per-instance cache
type CacheEntry = { body: unknown; ts: number };
type CacheStore = Map<string, CacheEntry>;
declare global {
  var __ART_CACHE__: CacheStore | undefined;
}
const CACHE: CacheStore = global.__ART_CACHE__ ?? new Map();
if (!global.__ART_CACHE__) global.__ART_CACHE__ = CACHE;

const TTL_MS = 30_000;       // serve fresh for 30s
const STALE_MS = 5 * 60_000; // allow stale up to 5m on DB error

const TOPICS = new Set(["rankings", "start-sit", "advice", "dfs", "waiver-wire", "injury"]);

async function withRetries<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let err: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      err = e;
      await new Promise((r) => setTimeout(r, 300 * i * i));
    }
  }
  throw err;
}

type SqlParam = string | number | boolean | null | readonly string[];

export async function GET(req: Request) {
  const url = new URL(req.url);
  const cacheKey = url.search;

  // 1) serve fresh cache
  const now = Date.now();
  const hit = CACHE.get(cacheKey);
  if (hit && now - hit.ts < TTL_MS) {
    return NextResponse.json(hit.body, { status: 200, headers: { "x-cache": "HIT" } });
  }

  // query params
  const sport = (url.searchParams.get("sport") || "nfl").toLowerCase();
  const topicRaw = url.searchParams.get("topic")?.toLowerCase() || null;
  const topic = topicRaw && TOPICS.has(topicRaw) ? topicRaw : null;

  const weekParam = url.searchParams.get("week");
  const week = weekParam ? Number(weekParam) : null;

  const days = Number(url.searchParams.get("days") ?? "45");
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "25"), 1), 100);

  // build SQL
  const where: string[] = [];
  const params: SqlParam[] = [];

  params.push(sport);
  where.push(`a.sport = $${params.length}`);

  params.push(String(days));
  where.push(
    `(a.published_at >= NOW() - ($${params.length} || ' days')::interval
      OR a.discovered_at >= NOW() - ($${params.length} || ' days')::interval)`
  );

  if (topic) {
    params.push([topic] as const);
    where.push(`a.topics && $${params.length}::text[]`);
  }

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
    const body = { items: result.rows, nextCursor: null };

    CACHE.set(cacheKey, { body, ts: now });

    return NextResponse.json(body, {
      status: 200,
      headers: {
        "x-cache": hit ? "STALE->FRESH" : "MISS",
        "Cache-Control": "s-maxage=30, stale-while-revalidate=300",
      },
    });
  } catch (e) {
    // 2) on DB failure, serve stale if available
    if (hit && now - hit.ts < STALE_MS) {
      return NextResponse.json(hit.body, { status: 200, headers: { "x-cache": "STALE" } });
    }
    console.error("[/api/articles] error:", e);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}
