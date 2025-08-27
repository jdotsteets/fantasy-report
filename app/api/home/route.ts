// app/api/home/route.ts
import { NextResponse } from "next/server";
import { getHomeData } from "@/lib/HomeData";

export const preferredRegion = ["iad1"];
export const runtime = "nodejs";

// tiny in-memory cache (per lambda instance)
type CacheEntry = { body: unknown; ts: number };
type CacheStore = Map<string, CacheEntry>;
declare global {
  var __HOME_CACHE__: CacheStore | undefined;
}
const CACHE: CacheStore = global.__HOME_CACHE__ ?? new Map();
if (!global.__HOME_CACHE__) global.__HOME_CACHE__ = CACHE;

const TTL_MS = 30_000;
const STALE_MS = 5 * 60_000;

export async function GET(req: Request) {
  const u = new URL(req.url);
  const cacheKey = u.search;

  const now = Date.now();
  const hit = CACHE.get(cacheKey);
  if (hit && now - hit.ts < TTL_MS) {
    return NextResponse.json(hit.body, { status: 200, headers: { "x-cache": "HIT" } });
  }

  const sport = (u.searchParams.get("sport") ?? "nfl").toLowerCase();
  const days = Number(u.searchParams.get("days") ?? "45");
  const week = u.searchParams.get("week") ? Number(u.searchParams.get("week")) : null;

  const limitNews       = Number(u.searchParams.get("limitNews") ?? "60");
  const limitRankings   = Number(u.searchParams.get("limitRankings") ?? "10");
  const limitStartSit   = Number(u.searchParams.get("limitStartSit") ?? "12");
  const limitAdvice     = Number(u.searchParams.get("limitAdvice") ?? "10");
  const limitDFS        = Number(u.searchParams.get("limitDFS") ?? "10");
  const limitWaivers    = Number(u.searchParams.get("limitWaivers") ?? "10");
  const limitInjuries   = Number(u.searchParams.get("limitInjuries") ?? "10");
  const limitHero       = Number(u.searchParams.get("limitHero") ?? "12");

  try {
    const body = await getHomeData({
      sport: sport as "nfl",
      days,
      week,
      limitNews,
      limitRankings,
      limitStartSit,
      limitAdvice,
      limitDFS,
      limitWaivers,
      limitInjuries,
      limitHero,
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
