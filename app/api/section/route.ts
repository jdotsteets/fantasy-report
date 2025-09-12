// app/api/section/route.ts
import { NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";

type SectionKey = "rankings" | "start-sit" | "waiver-wire" | "dfs" | "injury" | "advice" | "news";

type Row = {
  id: number;
  title: string;
  url: string;
  canonical_url: string | null;
  domain: string | null;
  image_url: string | null;
  published_at: string | null;
  discovered_at: string | null;
  source: string | null;
  ts: string | null;
};

const VALID: ReadonlySet<string> = new Set([
  "rankings","start-sit","waiver-wire","dfs","injury","advice","news"
]);

function parseProviderParam(raw: string | null): string | undefined {
  if (!raw) return undefined;
  const plusFixed = raw.replace(/\+/g, " ");
  let decoded = plusFixed;
  try { decoded = decodeURIComponent(plusFixed); } catch {}
  const out = decoded.trim();
  return out ? out : undefined;
}


export async function GET(req: Request) {
  const url = new URL(req.url);
  const key = (url.searchParams.get("key") ?? "").toLowerCase();
  if (!VALID.has(key)) return NextResponse.json({ items: [] }, { status: 200 });

  const limit    = clampInt(url.searchParams.get("limit"), 10, 1, 100);
  const offset   = clampInt(url.searchParams.get("offset"), 0, 0, 10_000);
  const days     = clampInt(url.searchParams.get("days"), 45, 1, 365);
  const week     = toIntOrUndef(url.searchParams.get("week"));
  const sourceId = toIntOrUndef(url.searchParams.get("sourceId"));
  const provider = parseProviderParam(url.searchParams.get("provider"));
  const cap      = clampInt(url.searchParams.get("perSourceCap"), 2, 1, 10);

// app/api/section/route.ts (snippet – filt CTE only)
  const sql = `
  WITH filt AS (
    SELECT
      a.id, a.title, a.url, a.canonical_url, a.domain, a.image_url,
      a.published_at, a.discovered_at,
      s.name AS source,
      COALESCE(a.published_at, a.discovered_at) AS ts,
      a.primary_topic, a.topics, a.week
    FROM articles a
    JOIN sources s ON s.id = a.source_id
    WHERE a.sport = 'nfl'
      AND (
        a.published_at    >= NOW() - ($1::text || ' days')::interval
        OR a.discovered_at >= NOW() - ($1::text || ' days')::interval
      )
      AND ($2::int  IS NULL OR a.source_id = $2::int)
      -- ✅ exact, case-insensitive match on sources.provider
      AND ($3::text IS NULL OR LOWER(s.provider) = LOWER($3::text))
  ),
  bucket_pre AS (
    SELECT *,
           row_number() OVER (PARTITION BY source ORDER BY ts DESC) AS rn
    FROM filt
    WHERE ($4::text = 'news')
       OR ($4::text = 'rankings'    AND (primary_topic='rankings'    OR 'rankings'    = ANY(topics)))
       OR ($4::text = 'start-sit'   AND (primary_topic='start-sit'   OR 'start-sit'   = ANY(topics)))
       OR ($4::text = 'waiver-wire' AND (primary_topic='waiver-wire' OR 'waiver-wire' = ANY(topics))
                                        AND ($5::int IS NULL OR week = $5::int))
       OR ($4::text = 'dfs'         AND (primary_topic='dfs'         OR 'dfs'         = ANY(topics)))
       OR ($4::text = 'injury'      AND (primary_topic='injury'      OR 'injury'      = ANY(topics)))
       OR ($4::text = 'advice'      AND (primary_topic='advice'      OR 'advice'      = ANY(topics)))
  ),
  capped AS (
    SELECT * FROM bucket_pre WHERE rn <= $6::int ORDER BY ts DESC LIMIT 400
  )
  SELECT id, title, url, canonical_url, domain, image_url,
         published_at, discovered_at, source, ts
  FROM capped
  ORDER BY ts DESC;
  `;

  const { rows } = await dbQuery<Row>(
    sql,
    [String(days), sourceId ?? null, provider ?? null, key, week ?? null, cap],
    "section"
  );

  const interleaved = roundRobinBySource(rows, limit, offset);
  return NextResponse.json({ items: interleaved }, { status: 200 });
}

/* helpers */
function clampInt(raw: string | null, def: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  const i = Math.trunc(n);
  return Math.min(max, Math.max(min, i));
}
function toIntOrUndef(v: string | null): number | undefined {
  if (v == null || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}
function strOrUndef(v: string | null): string | undefined {
  return v && v.trim() !== "" ? v.trim() : undefined;
}
function roundRobinBySource(rows: Row[], limit: number, offset: number): Row[] {
  const groups = new Map<string, Row[]>();
  for (const r of rows) (groups.get(r.source ?? "unknown") ?? groups.set(r.source ?? "unknown", []).get(r.source ?? "unknown")!) .push(r);
  const sources = Array.from(groups.keys()).sort((a, b) => {
    const ta = groups.get(a)![0]?.ts ?? "";
    const tb = groups.get(b)![0]?.ts ?? "";
    return (tb > ta ? 1 : tb < ta ? -1 : 0);
  });
  const cursors = new Map<string, number>(sources.map(s => [s, 0]));
  const out: Row[] = [];
  while (out.length < offset + limit) {
    let progressed = false;
    for (const s of sources) {
      const i = cursors.get(s)!;
      const g = groups.get(s)!;
      if (i < g.length) { out.push(g[i]); cursors.set(s, i + 1); progressed = true; if (out.length >= offset + limit) break; }
    }
    if (!progressed) break;
  }
  return out.slice(offset, offset + limit);
}
