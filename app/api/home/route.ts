// app/api/home/route.ts
import { NextResponse } from "next/server";
import { getHomeData } from "@/lib/HomeData";

export const preferredRegion = ["iad1"];
export const runtime = "nodejs";

// ───────────────────────────────────────────────────────────
// Tiny per-instance cache (helps burst traffic a bit)
// ───────────────────────────────────────────────────────────
type CacheEntry = { body: unknown; ts: number };
type CacheStore = Map<string, CacheEntry>;


declare global { var __HOME_CACHE__: CacheStore | undefined; }

const CACHE: CacheStore = global.__HOME_CACHE__ ?? new Map();
if (!global.__HOME_CACHE__) global.__HOME_CACHE__ = CACHE;

const TTL_MS = 30_000;       // serve from cache for 30s
const STALE_MS = 5 * 60_000; // serve stale for up to 5m if DB fails

// ───────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────
function clampInt(
  raw: string | null,
  def: number,
  min = 1,
  max = Number.MAX_SAFE_INTEGER
): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function parseWeek(raw: string | null): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

// ───────────────────────────────────────────────────────────
// Route
// ───────────────────────────────────────────────────────────
export async function GET(req: Request) {
  const u = new URL(req.url);
  const cacheKey = u.search;

  // quick hit from in-memory cache
  const now = Date.now();
  const hit = CACHE.get(cacheKey);
  if (hit && now - hit.ts < TTL_MS) {
    return NextResponse.json(hit.body, { status: 200, headers: { "x-cache": "HIT" } });
  }

  // inputs (sanitized)
  const sport = (u.searchParams.get("sport") ?? "nfl").toLowerCase() as "nfl";

  const days          = clampInt(u.searchParams.get("days"), 45, 1, 365);
  const week          = parseWeek(u.searchParams.get("week")); // only Waivers uses this

  const limitNews     = clampInt(u.searchParams.get("limitNews"),     60, 1, 100);
  const limitRankings = clampInt(u.searchParams.get("limitRankings"), 10, 1, 100);
  const limitStartSit = clampInt(u.searchParams.get("limitStartSit"), 12, 1, 100);
  const limitAdvice   = clampInt(u.searchParams.get("limitAdvice"),   10, 1, 100);
  const limitDFS      = clampInt(u.searchParams.get("limitDFS"),      10, 1, 100);
  const limitWaivers  = clampInt(u.searchParams.get("limitWaivers"),  10, 1, 100);
  const limitInjuries = clampInt(u.searchParams.get("limitInjuries"), 10, 1, 100);
  const limitHero     = clampInt(u.searchParams.get("limitHero"),     12, 1, 24);

  try {
    const body = await getHomeData({
      sport,
      days,
      week,               // null is fine; Waivers handler uses it
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
    // serve stale if we have it
    if (hit && now - hit.ts < STALE_MS) {
      return NextResponse.json(hit.body, { status: 200, headers: { "x-cache": "STALE" } });
    }
    console.error("[/api/home] error:", e);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}
