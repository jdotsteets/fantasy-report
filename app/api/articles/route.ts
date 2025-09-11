// app/api/articles/route.ts
import { NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";

export const preferredRegion = ["iad1"];
export const runtime = "nodejs";         // ensure Node runtime (not edge)
export const dynamic = "force-dynamic";  // NEVER prerender this route
export const revalidate = 0;             // disable caching for the route

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

// Topics we support via this endpoint (maps to primary_topic)
const TOPICS = new Set([
  "rankings",
  "start-sit",
  "advice",
  "dfs",
  "waiver-wire",
  "injury",
  "sleepers",
]);

type SqlParam = string | number | boolean | null | readonly string[];

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

  // time window (reuse the same bind twice)
  params.push(String(days));
  where.push(
    `(a.published_at >= NOW() - ($${params.length} || ' days')::interval
      OR a.discovered_at >= NOW() - ($${params.length} || ' days')::interval)`
  );

  // sport hard-stop
  where.push(`COALESCE(a.sport, 'nfl') = 'nfl'`);

  // optional topic: prefer primary_topic, else pick best from topics
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

  // optional exact week
  if (Number.isFinite(week)) {
    params.push(Number(week!));
    where.push(`a.week = $${params.length}`);
  }

  // Exclude detected player pages (computed column)
  where.push(`a.is_player_page IS NOT TRUE`);

  // Keep NBCSports to /nfl/
  where.push(`NOT (a.domain ILIKE '%nbcsports.com%' AND a.url NOT ILIKE '%/nfl/%')`);

  // Static/Resource pages – drop broad site indexes & utility pages
  where.push(`NOT (a.url ~* '/(tags?|category|topics?|teams?|roster|depth-?chart|schedules?|standings?|videos?/channel|highlights?)(/|$)')`);
  where.push(
    `NOT (COALESCE(a.cleaned_title, a.title) ~* '^(Highlights|Teams?|News|Articles|Subscribe|Lineup Generator|DFS Pass|Multi Lineup Optimizer)$')`
  );

  // Betting/Promos – exclude outright
  where.push(
    `NOT (COALESCE(a.cleaned_title, a.title) ~* '\\y(promo|promotion|bonus\\s*code|odds|best\\s*bets?|parlay|props?|sportsbook|betting)\\y'
          OR a.url ~* '/(sportsbook|odds|betting)/')`
  );

  // Gate keeper sources 3135/3138/3141 to nfl/fantasy-football (title or url)
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

  // Waiver section must contain explicit waiver/streamer/add/drop/FAAB signals
  if (topic === "waiver-wire") {
    // keep backslashes for Postgres regex
    const waiverRe =
      `(waiver(?:\\s*wire)?|waivers|pick[\\s-]*ups?|adds?|drop(?:s|\\/adds?)?|streamers?|faab|stash(?:es)?|deep\\s*adds?)`;
    where.push(
      `(COALESCE(a.cleaned_title, a.title) ~* '${waiverRe}' OR a.url ~* '${waiverRe}')`
    );
  }

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
        s.provider
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
