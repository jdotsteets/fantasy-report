// app/api/articles/route.ts
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// allow arrays for domain lists
type SQLParam = string | number | boolean | Date | null | string[];

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

function parseCursor(cursor: string | null): { ts: string; id: number } | null {
  if (!cursor) return null;
  const [ts, idStr] = cursor.split("|");
  const d = new Date(ts);
  const id = Number(idStr);
  if (!Number.isFinite(id) || Number.isNaN(d.getTime())) return null;
  return { ts: d.toISOString(), id };
}

function clamp(n: number, min: number, max: number) {
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

// --- add these brand/domain patterns ---
const ADS_TITLE_RE =
  "(promo\\s*code|bonus\\s*code|no\\s*deposit|sign[- ]?up bonus|profit boost|odds boost|bonus bets?|free bets?|bet\\s*credits?)";

const SPORTSBOOK_BRANDS_RE =
  "(sportsbook|caesars|betmgm|draftkings|fanduel|bet365|pointsbet|betrivers|espn\\s*bet|barstool|wynnbet|betway|hard\\s*rock|unibet)";

const BOOK_DOMAINS = [
  "caesars.com",
  "betmgm.com",
  "draftkings.com",
  "fanduel.com",
  "bet365.com",
  "pointsbet.com",
  "betrivers.com",
  "espnbet.com",
  "barstoolsportsbook.com",
  "wynnbet.com",
  "hardrock.bet",
  "unibet.com",
  "betway.com",
];

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const sport    = (searchParams.get("sport") || "nfl").toLowerCase();
  const topic    = searchParams.get("topic");
  const weekRaw  = searchParams.get("week");
  const domain   = searchParams.get("domain");
  const source   = searchParams.get("source");
  const limit    = clamp(Number(searchParams.get("limit") ?? "20"), 1, 100);
  const sort     = (searchParams.get("sort") || "recent").toLowerCase(); // "recent" | "popular"
  const hasImage = ["1","true","yes"].includes((searchParams.get("hasImage") || "").toLowerCase());
  const allowAds = ["1","true","yes"].includes((searchParams.get("allowAds") || "").toLowerCase());
  const cursor   = parseCursor(searchParams.get("cursor"));

  const where: string[] = [`a.sport = $1`];
  const params: SQLParam[] = [sport];
  let p = 2;

  if (topic) { where.push(`a.topics IS NOT NULL AND $${p} = ANY(a.topics)`); params.push(topic); p++; }
  if (weekRaw) { const w = Number(weekRaw); if (Number.isFinite(w)) { where.push(`a.week = $${p}`); params.push(w); p++; } }
  if (domain) { where.push(`a.domain ILIKE $${p}`); params.push(domain); p++; }
  if (source) { where.push(`s.name = $${p}`); params.push(source); p++; }
  if (hasImage) { where.push(`a.image_url IS NOT NULL AND a.image_url <> ''`); }

  // 🔒 Exclude obvious sportsbook promos unless allowAds=1
  if (!allowAds) {
    where.push(`
      NOT (
        (
          (a.title ~* $${p} OR a.cleaned_title ~* $${p})
          AND (a.title ~* $${p + 1} OR a.cleaned_title ~* $${p + 1})
        )
        OR a.domain = ANY($${p + 2}::text[])
        OR a.url ~* $${p + 1} -- brand in the URL + promo terms above
      )
    `);
    params.push(ADS_TITLE_RE, SPORTSBOOK_BRANDS_RE, BOOK_DOMAINS);
    p += 3;
  }

  if (cursor) {
    where.push(`(COALESCE(a.published_at, a.discovered_at), a.id) < ($${p}::timestamptz, $${p + 1}::int)`);
    params.push(cursor.ts, cursor.id); p += 2;
  }

  const orderRecent  = `COALESCE(a.published_at, a.discovered_at) DESC NULLS LAST, a.id DESC`;
  const orderPopular = `COALESCE(a.popularity_score, 0) DESC, ${orderRecent}`;
  const orderBy      = sort === "popular" ? orderPopular : orderRecent;

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
    WHERE ${where.join(" AND ")}
    ORDER BY ${orderBy}
    LIMIT $${p}
  `;
  params.push(limit);

  const { rows } = await query<ArticleRow>(sql, params);

  let nextCursor: string | null = null;
  if (rows.length === limit) {
    const last = rows[rows.length - 1];
    if (last?.order_ts && Number.isFinite(last.id)) {
      nextCursor = `${new Date(last.order_ts).toISOString()}|${last.id}`;
    }
  }

  return new Response(JSON.stringify({ items: rows, nextCursor }), {
    headers: { "content-type": "application/json" },
  });
}
