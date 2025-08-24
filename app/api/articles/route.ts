import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SQLParam = string | number | boolean | Date | null;

type ArticleRow = {
  id: number;
  title: string;
  url: string;
  canonical_url: string | null;
  domain: string | null;
  image_url: string | null;
  published_at: string | null;
  discovered_at: string | null;
  week: number | null;
  topics: string[] | null;
  source: string;
  order_ts: string | null;
};

function clamp(n: number, min: number, max: number) {
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function parseCursor(cursor: string | null): { ts: string; id: number } | null {
  if (!cursor) return null;
  const [ts, idStr] = cursor.split("|");
  const d = new Date(ts);
  const id = Number(idStr);
  if (!Number.isFinite(id) || Number.isNaN(d.getTime())) return null;
  return { ts: d.toISOString(), id };
}

const BAD_DOMAINS = new Set([
  "caesars.com","betmgm.com","draftkings.com","fanduel.com","bet365.com","pointsbet.com","betrivers.com",
  "espnbet.com","barstoolsportsbook.com","wynnbet.com","hardrock.bet","unibet.com","betway.com",
]);
const BRAND_RE = /(sportsbook|caesars|betmgm|draftkings|fanduel|bet365|pointsbet|betrivers|espn\s*bet|barstool|wynnbet|hard\s*rock|unibet|betway)/i;
const PROMO_RE = /(promo\s*code|bonus\s*code|no\s*deposit|sign[- ]?up bonus|profit boost|odds boost|bonus bets?|free bets?|bet\s*credits?)/i;

function looksLikeGambling(r: Pick<ArticleRow,"title"|"domain"|"url">) {
  const title = r.title ?? "";
  const url = r.url ?? "";
  const domain = (r.domain ?? "").toLowerCase();
  if (BAD_DOMAINS.has(domain)) return true;
  if (BRAND_RE.test(url)) return true;
  if (BRAND_RE.test(title) && PROMO_RE.test(title)) return true;
  return false;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const sport  = searchParams.get("sport") || "nfl";
    const topic  = searchParams.get("topic");
    const week   = searchParams.get("week");
    const limit  = clamp(Number(searchParams.get("limit") ?? "20"), 1, 100);
    const cursor = parseCursor(searchParams.get("cursor"));
    const days   = clamp(Number(searchParams.get("days") ?? "45"), 7, 365);

    const where: string[] = ["a.sport = $1"];
    const params: SQLParam[] = [sport];
    let p = 2;

    // time window (helps ordering)
    where.push(`(a.published_at >= NOW() - INTERVAL '${days} days'
              OR a.discovered_at >= NOW() - INTERVAL '${days} days')`);

    if (topic) {
      where.push(`a.topics @> ARRAY[$${p}]::text[]`);
      params.push(topic);
      p++;
    }
    if (week) {
      where.push(`a.week = $${p}`);
      params.push(Number(week));
      p++;
    }
    if (cursor) {
      where.push(`(COALESCE(a.published_at, a.discovered_at), a.id) < ($${p}::timestamptz, $${p + 1}::int)`);
      params.push(cursor.ts, cursor.id);
      p += 2;
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const fetchCount = Math.max(limit * 3, 60);

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
      ${whereSql}
      ORDER BY COALESCE(a.published_at, a.discovered_at) DESC NULLS LAST, a.id DESC
      LIMIT $${p}
    `;
    params.push(fetchCount);

    const { rows } = await query<ArticleRow>(sql, params);

    const filtered = rows.filter((r) => !looksLikeGambling(r)).slice(0, limit);

    let nextCursor: string | null = null;
    if (rows.length === fetchCount) {
      const last = rows[rows.length - 1];
      if (last?.order_ts && Number.isFinite(last.id)) {
        nextCursor = `${new Date(last.order_ts).toISOString()}|${last.id}`;
      }
    }

    return new Response(JSON.stringify({ items: filtered, nextCursor }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    // Always return JSON so your console shows the message
    console.error("[/api/articles] error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}
