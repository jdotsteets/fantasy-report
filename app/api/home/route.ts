// app/api/home/route.ts
import { NextResponse } from "next/server";
import { withClient } from "@/lib/db";

export const preferredRegion = ["iad1"];
export const runtime = "nodejs";

// tiny in‑memory cache (per lambda instance)
type CacheEntry = { body: unknown; ts: number };
type CacheStore = Map<string, CacheEntry>;
declare global {
  var __HOME_CACHE__: CacheStore | undefined;
}
const CACHE: CacheStore = global.__HOME_CACHE__ ?? new Map();
if (!global.__HOME_CACHE__) global.__HOME_CACHE__ = CACHE;

const TTL_MS = 30_000;       // fresh for 30s
const STALE_MS = 5 * 60_000; // serve stale for 5m if DB is down

function clamp(n: number, min: number, max: number) {
  return Math.min(Math.max(n, min), max);
}

// Acceptable SQL param types for `pg`
type SqlParam = string | number | boolean | null | readonly string[];

export async function GET(req: Request) {
  const url = new URL(req.url);

  const sport = (url.searchParams.get("sport") || "nfl").toLowerCase();
  const week = url.searchParams.get("week") ? Number(url.searchParams.get("week")) : null;
  const days = Number(url.searchParams.get("days") ?? "45");

  const limitNews      = clamp(Number(url.searchParams.get("limitNews") ?? "25"), 1, 100);
  const limitRankings  = clamp(Number(url.searchParams.get("limitRankings") ?? "10"), 1, 100);
  const limitStartSit  = clamp(Number(url.searchParams.get("limitStartSit") ?? "12"), 1, 100);
  const limitAdvice    = clamp(Number(url.searchParams.get("limitAdvice") ?? "10"), 1, 100);
  const limitDFS       = clamp(Number(url.searchParams.get("limitDFS") ?? "10"), 1, 100);
  const limitWaivers   = clamp(Number(url.searchParams.get("limitWaivers") ?? "10"), 1, 100);
  const limitInjuries  = clamp(Number(url.searchParams.get("limitInjuries") ?? "10"), 1, 100);
  const limitHero      = clamp(Number(url.searchParams.get("limitHero") ?? "12"), 1, 100);

  const cacheKey = JSON.stringify({
    sport, week, days,
    limitNews, limitRankings, limitStartSit, limitAdvice,
    limitDFS, limitWaivers, limitInjuries, limitHero,
  });

  // serve fresh from cache if valid
  const now = Date.now();
  const hit = CACHE.get(cacheKey);
  if (hit && now - hit.ts < TTL_MS) {
    return NextResponse.json(hit.body, { status: 200, headers: { "x-cache": "HIT" } });
  }

  try {
    const body = await withClient(async (c) => {
      // NOTE: no leading AND here
      const baseWindow = `
        (a.published_at >= NOW() - ($1 || ' days')::interval
         OR a.discovered_at >= NOW() - ($1 || ' days')::interval)
      `;

      // Single helper; builds placeholders based on current param list
      const q = async (
        limit: number,
        opts: { topic?: string; weekEq?: number | null }
      ) => {
        const ps: SqlParam[] = [String(days), sport]; // $1 days, $2 sport
        const whereParts: string[] = ["a.sport = $2", baseWindow];

        if (opts.topic) {
          whereParts.push(`a.topics && $${ps.length + 1}::text[]`);
          ps.push([opts.topic] as const); // ARRAY['topic']
        }
        if (typeof opts.weekEq === "number") {
          whereParts.push(`a.week = $${ps.length + 1}`);
          ps.push(opts.weekEq);
        }

        const sql = `
          SELECT
            a.id, COALESCE(a.cleaned_title, a.title) AS title,
            a.url, a.canonical_url, a.domain, a.image_url,
            a.published_at, a.discovered_at, a.week, a.topics,
            s.name AS source,
            COALESCE(a.published_at, a.discovered_at) AS order_ts
          FROM articles a
          JOIN sources s ON s.id = a.source_id
          WHERE ${whereParts.join(" AND ")}
          ORDER BY COALESCE(a.published_at, a.discovered_at) DESC NULLS LAST, a.id DESC
          LIMIT ${limit}
        `;

        const { rows } = await c.query<Record<string, unknown>>(sql, ps as unknown[]);
        return rows;
      };

      const [
        latest,
        rankings,
        startSit,
        adviceRows,
        dfs,
        waivers,
        injuries,
        heroCandidates,
      ] = await Promise.all([
        q(limitNews,    {                     }),
        q(limitRankings,{ topic: "rankings"   }),
        q(limitStartSit,{ topic: "start-sit", weekEq: week }),
        q(limitAdvice,  { topic: "advice"     }),
        q(limitDFS,     { topic: "dfs"        }),
        q(limitWaivers, { topic: "waiver-wire"}),
        q(limitInjuries,{ topic: "injury"     }),
        q(limitHero,    {                     }),
      ]);

      return {
        items: {
          latest,
          rankings,
          startSit,
          advice: adviceRows,
          dfs,
          waivers,
          injuries,
          heroCandidates,
        },
      };
    });

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
    console.error("[/api/home] error:", e);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}
