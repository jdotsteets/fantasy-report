// app/api/articles/route.ts
import { NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";

export const preferredRegion = ["iad1"];
export const runtime = "nodejs";

// tiny per-instance cache
type CacheEntry = { body: unknown; ts: number };
type CacheStore = Map<string, CacheEntry>;
declare global { 
  var __ART_CACHE__: CacheStore | undefined;
}
const CACHE: CacheStore = global.__ART_CACHE__ ?? new Map();
if (!global.__ART_CACHE__) global.__ART_CACHE__ = CACHE;

const TTL_MS = 30_000;
const STALE_MS = 5 * 60_000;

// Topics we support client-side. We’ll map to a single “primary_topic” on the DB side.
const TOPICS = new Set(["rankings", "start-sit", "advice", "dfs", "waiver-wire", "injury", "sleepers"]);

type SqlParam = string | number | boolean | null | readonly string[];

async function withRetries<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let err: unknown;
  for (let i = 1; i <= attempts; i++) {
    try { return await fn(); }
    catch (e) { err = e; await new Promise((r) => setTimeout(r, 300 * i * i)); }
  }
  throw err;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const cacheKey = url.search;

  // serve from tiny cache
  const now = Date.now();
  const hit = CACHE.get(cacheKey);
  if (hit && now - hit.ts < TTL_MS) {
    return NextResponse.json(hit.body, { status: 200, headers: { "x-cache": "HIT" } });
  }

  // query params
  const topicRaw = url.searchParams.get("topic")?.toLowerCase() || null;
  const topic = topicRaw && TOPICS.has(topicRaw) ? topicRaw : null;

  const weekParam = url.searchParams.get("week");
  const week = weekParam ? Number(weekParam) : null;

  const days = Number(url.searchParams.get("days") ?? "45");
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "25"), 1), 100);

  // build SQL
  const where: string[] = [];
  const params: SqlParam[] = [];

  // time window
  params.push(String(days));
  where.push(
    `(a.published_at >= NOW() - ($${params.length} || ' days')::interval
      OR a.discovered_at >= NOW() - ($${params.length} || ' days')::interval)`
  );

  // optional topic: prefer single primary_topic if present; otherwise compute a winner
  if (topic) {
    params.push(topic);
    where.push(`(
      COALESCE(a.primary_topic,
        CASE
          WHEN a.topics && ARRAY['sleepers']::text[]     THEN 'sleepers'
          WHEN a.topics && ARRAY['waiver-wire']::text[]  THEN 'waiver-wire'
          WHEN a.topics && ARRAY['rankings']::text[]     THEN 'rankings'
          WHEN a.topics && ARRAY['injury']::text[]       THEN 'injury'
          WHEN a.topics && ARRAY['start-sit']::text[]    THEN 'start-sit'
          WHEN a.topics && ARRAY['dfs']::text[]          THEN 'dfs'
          WHEN a.topics && ARRAY['advice']::text[]       THEN 'advice'
          ELSE NULL
        END
      ) = $${params.length}
    )`);
  }

  // optional week
  if (Number.isFinite(week)) {
    params.push(Number(week!));
    where.push(`a.week = $${params.length}`);
  }

  // Exclude obvious player pages (FantasyPros/NBCSports) and restrict NBCSports to /nfl/
  params.push("»%");
  where.push(`NOT (a.source_id = 3126 AND COALESCE(a.cleaned_title, a.title) LIKE $${params.length})`);
  where.push(`NOT (
    a.domain ILIKE '%fantasypros.com%'
    AND a.url ~* '/nfl/(players|stats|news)/[a-z0-9-]+\\.php$'
  )`);
  where.push(`NOT (
    a.domain ILIKE '%nbcsports.com%'
    AND (
      a.url ~* '/nfl/[a-z0-9-]+/\\d+/?$'
      OR COALESCE(a.cleaned_title, a.title) ~* '^[A-Z][A-Za-z\\.'\\-]+( [A-Z][A-Za-z\\.'\\-]+){0,3}$'
    )
  )`);
  // kick non-NFL NBCSports
  where.push(`NOT (a.domain ILIKE '%nbcsports.com%' AND a.url NOT ILIKE '%/nfl/%')`);

  // Gate keeper sources 3135/3138/3141 to nfl/fantasy-football only (in title or url)
  const nflLike = "%nfl%";
  const ffLike = "%fantasy%football%";
  params.push(nflLike, nflLike, ffLike, ffLike);
  const baseIdx = params.length - 3;
  where.push(
    `(a.source_id NOT IN (3135, 3138, 3141) OR (
       COALESCE(a.cleaned_title, a.title) ILIKE $${baseIdx}
       OR a.url ILIKE $${baseIdx + 1}
       OR COALESCE(a.cleaned_title, a.title) ILIKE $${baseIdx + 2}
       OR a.url ILIKE $${baseIdx + 3}
     ))`
  );

  // final limit
  params.push(limit);

  const sql = `
    WITH filtered AS (
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
    ),
    ranked AS (
      SELECT *,
             ROW_NUMBER() OVER (
               PARTITION BY COALESCE(canonical_url, url)
               ORDER BY order_ts DESC NULLS LAST, id DESC
             ) AS rn
      FROM filtered
    )
    SELECT id, title, url, canonical_url, domain, image_url, published_at, discovered_at, week, topics, source, order_ts
    FROM ranked
    WHERE rn = 1
    ORDER BY order_ts DESC NULLS LAST, id DESC
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
    if (hit && now - hit.ts < STALE_MS) {
      return NextResponse.json(hit.body, { status: 200, headers: { "x-cache": "STALE" } });
    }
    console.error("[/api/articles] error:", e);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}
