// lib/HomeData.ts
import { dbQuery } from "@/lib/db";
import { pickBestImage } from "@/lib/images.server"; // server-only helper
import { isWeakArticleImage } from "@/lib/images";   // safe favicon/placeholder detector

type IdList = number[];

/* ───────────────────────── Types ───────────────────────── */

export type HomeParams = {
  sport: "nfl";
  days: number;
  week?: number | null;
  limitNews: number;
  limitRankings: number;
  limitStartSit: number;
  limitAdvice: number;
  limitDFS: number;
  limitWaivers: number;
  limitInjuries: number;
  limitHero: number;

  /** Optional: show a dedicated Static section (excluded from all other sections). */
  staticSectionLimit?: number;       // default 0 (off)
  staticTypes?: string[] | null;     // e.g. ["rankings"]. null/undefined => any static_type
};

export type DbRow = {
  id: number;
  title: string;
  url: string;
  canonical_url: string | null;
  domain: string;
  image_url: string | null;
  published_at: string | null;
  discovered_at: string | null;
  week: number | null;
  topics: string[] | null;
  source: string;
};

type PoolRow = DbRow & {
  primary_topic: string | null;   // raw from DB (may be underscored)
  secondary_topic: string | null; // raw from DB (may be underscored)
  order_ts: string | null;        // ISO-ish string from SQL
};

export type HomePayload = {
  items: {
    latest: DbRow[];
    rankings: DbRow[];
    startSit: DbRow[];
    advice: DbRow[];
    dfs: DbRow[];
    waivers: DbRow[];
    injuries: DbRow[];
    heroCandidates: DbRow[];
    /** Present only when staticSectionLimit > 0 */
    staticItems?: DbRow[];
  };
};

/* ───────────────────── Helpers / Normalizers ───────────────────── */

type CanonTopic =
  | "rankings"
  | "start-sit"
  | "waiver-wire"
  | "dfs"
  | "injury"
  | "advice";

function normalizeTopic(t: string | null | undefined): CanonTopic | null {
  if (!t) return null;
  const v = t.toLowerCase().replace(/_/g, "-");
  if (v === "waiver") return "waiver-wire";
  if (v === "start-sit" || v === "start_sit") return "start-sit";
  switch (v) {
    case "rankings":
    case "start-sit":
    case "waiver-wire":
    case "dfs":
    case "injury":
    case "advice":
      return v;
    default:
      return null;
  }
}

function normalizedTopicsArray(arr: string[] | null | undefined): string[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((t) => t?.toLowerCase().replace(/_/g, "-")).filter(Boolean);
}

/** If DB has no primary_topic, derive one from topics[] with precedence. */
function derivePrimaryFromTopics(topics: string[]): CanonTopic | null {
  // precedence: sleepers → start-sit, then waiver-wire, rankings, injury, start-sit, dfs, advice
  if (topics.includes("sleepers")) return "start-sit";
  if (topics.includes("waiver-wire") || topics.includes("waiver")) return "waiver-wire";
  if (topics.includes("rankings")) return "rankings";
  if (topics.includes("injury")) return "injury";
  if (topics.includes("start-sit") || topics.includes("start_sit")) return "start-sit";
  if (topics.includes("dfs")) return "dfs";
  if (topics.includes("advice")) return "advice";
  return null;
}

/** Simple keyword helpers for overflow */
const RE_STARTSIT = /(\bstart[\s/-]?sit\b|\bsleeper(s)?\b|who to (start|sit))/i;
const RE_WAIVER   = /\b(waiver(s)?|pick[\s-]?ups?|adds?|wire)\b/i;

function looksStartSit(title: string, url: string) {
  return RE_STARTSIT.test(title) || RE_STARTSIT.test(url);
}
function looksWaiver(title: string, url: string) {
  return RE_WAIVER.test(title) || RE_WAIVER.test(url);
}

const toDbRow = (r: PoolRow): DbRow => ({
  id: r.id,
  title: r.title,
  url: r.url,
  canonical_url: r.canonical_url,
  domain: r.domain,
  image_url: r.image_url,
  published_at: r.published_at,
  discovered_at: r.discovered_at,
  week: r.week,
  topics: r.topics,
  source: r.source,
});

/* ───────────────────── SQL (recent pool) ───────────────────── */

function buildPoolSql(): string {
  // NOTE: exclude static pages from the main pool
  return `
    WITH base AS (
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
        a.primary_topic,
        a.secondary_topic,
        s.name AS source,
        COALESCE(a.published_at, a.discovered_at) AS order_ts
      FROM articles a
      JOIN sources s ON s.id = a.source_id
      WHERE
        (
          (a.published_at IS NOT NULL
            AND a.published_at >= NOW() - ($1 || ' days')::interval)
          OR
          (a.published_at IS NULL
            AND a.discovered_at >= NOW() - ($1 || ' days')::interval)
        )
        AND a.is_static IS NOT TRUE
        AND a.is_player_page IS NOT TRUE
        AND NOT (a.domain ILIKE '%nbcsports.com%' AND a.url NOT ILIKE '%/nfl/%')
        AND (
          a.source_id NOT IN (3135,3138,3141) OR (
            COALESCE(a.cleaned_title, a.title) ILIKE '%nfl%'
            OR a.url ILIKE '%nfl%'
            OR COALESCE(a.cleaned_title, a.title) ILIKE '%fantasy%football%'
            OR a.url ILIKE '%fantasy%football%'
          )
        )
    ),
    ranked AS (
      SELECT *,
             ROW_NUMBER() OVER (
               PARTITION BY COALESCE(canonical_url, url)
               ORDER BY order_ts DESC NULLS LAST, id DESC
             ) AS rn
      FROM base
    )
    SELECT
      id, title, url, canonical_url, domain, image_url, published_at, discovered_at, week, topics, source,
      primary_topic, secondary_topic, order_ts::text
    FROM ranked
    WHERE rn = 1
    ORDER BY order_ts DESC NULLS LAST, id DESC
    LIMIT $2
  `;
}

// Topic-targeted fetch used when a bucket is underfilled (also excludes static)
async function fetchMoreByTopic(
  topic: CanonTopic,
  days: number,
  limit: number,
  excludeIds: IdList,
  week: number | null // only used for waivers
) {
  const { rows } = await dbQuery<DbRow>(
    `
    WITH base AS (
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
      WHERE
        (
          (a.published_at IS NOT NULL
            AND a.published_at >= NOW() - ($1 || ' days')::interval)
          OR
          (a.published_at IS NULL
            AND a.discovered_at >= NOW() - ($1 || ' days')::interval)
        )
        AND a.is_static IS NOT TRUE
        AND a.is_player_page IS NOT TRUE
        AND NOT (a.domain ILIKE '%nbcsports.com%' AND a.url NOT ILIKE '%/nfl/%')
        AND (
          a.source_id NOT IN (3135, 3138, 3141) OR
          COALESCE(a.cleaned_title, a.title) ILIKE '%nfl%' OR
          a.url ILIKE '%nfl%' OR
          COALESCE(a.cleaned_title, a.title) ILIKE '%fantasy%football%' OR
          a.url ILIKE '%fantasy%football%'
        )
        AND a.primary_topic = $2
        AND ($3::int IS NULL OR a.week = $3)           -- only constrains waivers when week is provided
        AND NOT (a.id = ANY($4::int[]))                -- don’t duplicate anything already placed
    )
    SELECT id, title, url, canonical_url, domain, image_url,
           published_at, discovered_at, week, topics, source
    FROM base
    ORDER BY order_ts DESC NULLS LAST, id DESC
    LIMIT $5
    `,
    [String(days), topic, week, excludeIds, limit]
  );

  return rows;
}

// Dedicated static-page fetch (for the optional static section)
async function fetchStaticPages(
  days: number,
  limit: number,
  types: string[] | null | undefined
): Promise<DbRow[]> {
  const { rows } = await dbQuery<DbRow>(
    `
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
      s.name AS source
    FROM articles a
    JOIN sources s ON s.id = a.source_id
    WHERE
      a.is_static IS TRUE
      AND (a.published_at >= NOW() - ($1 || ' days')::interval
           OR a.discovered_at >= NOW() - ($1 || ' days')::interval)
      AND NOT (a.domain ILIKE '%nbcsports.com%' AND a.url NOT ILIKE '%/nfl/%')
      AND (
        a.source_id NOT IN (3135,3138,3141) OR
        COALESCE(a.cleaned_title, a.title) ILIKE '%nfl%' OR
        a.url ILIKE '%nfl%' OR
        COALESCE(a.cleaned_title, a.title) ILIKE '%fantasy%football%' OR
        a.url ILIKE '%fantasy%football%'
      )
      AND (
        $2::text[] IS NULL
        OR a.static_type = ANY($2::text[])
      )
    ORDER BY COALESCE(a.published_at, a.discovered_at) DESC NULLS LAST, a.id DESC
    LIMIT $3
    `,
    [String(days), types && types.length ? types : null, limit]
  );
  return rows;
}

async function fetchPool(days: number, poolLimit: number): Promise<PoolRow[]> {
  const { rows } = await dbQuery<PoolRow>(buildPoolSql(), [String(days), poolLimit]);
  return rows;
}

/* ───────────────────── Main entry ───────────────────── */

export async function getHomeData(p: HomeParams): Promise<HomePayload> {
  const {
    days, week,
    limitNews, limitRankings, limitStartSit, limitAdvice, limitDFS, limitWaivers, limitInjuries, limitHero,
    staticSectionLimit = 0,
    staticTypes = null,
  } = p;

  // Plenty of headroom so "latest" can still fill even when primaries hit caps
  const sum =
    limitNews + limitRankings + limitStartSit + limitAdvice +
    limitDFS + limitWaivers + limitInjuries;
  const poolSize = Math.max(sum * 3, 400);

  const [poolRaw, staticRaw] = await Promise.all([
    fetchPool(days, poolSize),
    staticSectionLimit > 0 ? fetchStaticPages(days, staticSectionLimit * 2, staticTypes) : Promise.resolve([] as DbRow[]),
  ]);

  // Normalize rows & derive missing primary from topics if needed
  const pool = poolRaw.map((r) => {
    const topicsNorm = normalizedTopicsArray(r.topics);
    const primaryNorm = normalizeTopic(r.primary_topic) ?? derivePrimaryFromTopics(topicsNorm);
    const secondaryNorm = normalizeTopic(r.secondary_topic);
    return {
      ...r,
      topics: topicsNorm,
      primary_topic: primaryNorm,
      secondary_topic: secondaryNorm,
    };
  });

  const latest: DbRow[]   = [];
  const rankings: DbRow[] = [];
  const startSit: DbRow[] = [];
  const advice: DbRow[]   = [];
  const dfs: DbRow[]      = [];
  const waivers: DbRow[]  = [];
  const injuries: DbRow[] = [];
  const staticItems: DbRow[] = [];

  const placed = new Set<number>(); // global de-dupe across sections

  // ── per-source caps to avoid one site dominating ─────────────
  const PER_SOURCE_CAP: Record<CanonTopic, number> = {
    rankings: 2,
    "start-sit": 2,
    "waiver-wire": 2,
    dfs: 2,
    injury: 2,
    advice: 2,
  };
  const perSource: Record<CanonTopic, Record<string, number>> = {
    rankings: {}, "start-sit": {}, "waiver-wire": {}, dfs: {}, injury: {}, advice: {},
  };
  const canTakeFrom = (topic: CanonTopic, source: string) =>
    (perSource[topic][source] ?? 0) < (PER_SOURCE_CAP[topic] ?? 99);
  const inc = (topic: CanonTopic, source: string) =>
    (perSource[topic][source] = (perSource[topic][source] ?? 0) + 1);

  const tryAssign = (topic: CanonTopic, bucket: DbRow[], cap: number, r: PoolRow) => {
    if (bucket.length >= cap) return false;
    if (placed.has(r.id)) return false;
    if (!canTakeFrom(topic, r.source)) return false;
    bucket.push(toDbRow(r));
    placed.add(r.id);
    inc(topic, r.source);
    return true;
  };

  const wantWeek = (r: PoolRow) => week == null || r.week === week;

  // 1) Primary pass (recency order from dynamic pool)
  for (const r of pool) {
    switch (r.primary_topic) {
      case "rankings":    if (tryAssign("rankings", rankings, limitRankings, r)) continue; break;
      case "start-sit":   if (tryAssign("start-sit", startSit,  limitStartSit,  r)) continue; break;
      case "waiver-wire": if (wantWeek(r) && tryAssign("waiver-wire", waivers, limitWaivers, r)) continue; break;
      case "dfs":         if (tryAssign("dfs",      dfs,      limitDFS,      r)) continue; break;
      case "injury":      if (tryAssign("injury",   injuries, limitInjuries, r)) continue; break;
      case "advice":      if (tryAssign("advice",   advice,   limitAdvice,   r)) continue; break;
      default:            break;
    }
  }

  // 2) Secondary / overflow top-ups (leftovers only)
  const leftovers = pool.filter((r) => !placed.has(r.id));

  const topUp = (topic: CanonTopic, bucket: DbRow[], cap: number, pred: (r: PoolRow) => boolean) => {
    if (bucket.length >= cap) return;
    for (const r of leftovers) {
      if (bucket.length >= cap) break;
      if (placed.has(r.id)) continue;
      if (!pred(r)) continue;
      if (!canTakeFrom(topic, r.source)) continue;
      bucket.push(toDbRow(r));
      placed.add(r.id);
      inc(topic, r.source);
    }
  };

  // Rankings by secondary (keeps dynamic rankings)
  topUp("rankings", rankings, limitRankings, (r) => r.secondary_topic === "rankings");

  // Start/Sit by secondary, topics, or keywords (sleepers/start-sit)
  topUp(
    "start-sit",
    startSit,
    limitStartSit,
    (r) =>
      r.secondary_topic === "start-sit" ||
      (r.topics ?? []).some((t) => t === "start-sit" || t === "start_sit" || t === "sleepers") ||
      looksStartSit(r.title, r.url)
  );

  // Waivers by secondary, topics, or keywords (still respect week)
  topUp(
    "waiver-wire",
    waivers,
    limitWaivers,
    (r) =>
      wantWeek(r) &&
      (r.secondary_topic === "waiver-wire" ||
       (r.topics ?? []).some((t) => t === "waiver-wire" || t === "waiver") ||
       looksWaiver(r.title, r.url))
  );

  // DFS, Injuries, Advice by secondary
  topUp("dfs",      dfs,      limitDFS,      (r) => r.secondary_topic === "dfs");
  topUp("injury",   injuries, limitInjuries, (r) => r.secondary_topic === "injury");
  topUp("advice",   advice,   limitAdvice,   (r) => r.secondary_topic === "advice");

  /* 2b) Guaranteed fill: if any bucket is still short, fetch directly by topic. */
  async function guaranteeFill(
    bucketTopic: CanonTopic,
    bucket: DbRow[],
    cap: number,
    topic: CanonTopic,
    weekForTopic: number | null = null
  ) {
    if (bucket.length >= cap) return;
    const needed = cap - bucket.length;
    const excludeIds = Array.from(placed);
    const more = await fetchMoreByTopic(topic, days, needed * 2, excludeIds, weekForTopic);
    for (const r of more) {
      if (bucket.length >= cap) break;
      if (placed.has(r.id)) continue;
      if (!canTakeFrom(bucketTopic, r.source)) continue;
      bucket.push(r);
      placed.add(r.id);
      inc(bucketTopic, r.source);
    }
  }

  await guaranteeFill("rankings", rankings, limitRankings, "rankings");
  await guaranteeFill("start-sit", startSit, limitStartSit, "start-sit");
  await guaranteeFill("dfs",      dfs,      limitDFS,      "dfs");
  await guaranteeFill("injury",   injuries, limitInjuries, "injury");
  await guaranteeFill("advice",   advice,   limitAdvice,   "advice");
  await guaranteeFill("waiver-wire", waivers, limitWaivers, "waiver-wire", week ?? null);

  // 3) Image enhancement (server-side) for each bucket, in parallel.
  async function enhanceBucket(items: DbRow[], topic: CanonTopic | null) {
    if (items.length === 0) return;
    const enhanced = await Promise.all(
      items.map(async (it) => {
        const ok = it.image_url && !isWeakArticleImage(it.image_url);
        const chosen = ok
          ? (it.image_url as string)
          : await pickBestImage({
              articleImage: it.image_url ?? null,
              domain: it.domain,
              topic,
            });
        return { ...it, image_url: chosen };
      })
    );
    items.splice(0, items.length, ...enhanced);
  }

  await Promise.all([
    enhanceBucket(rankings, "rankings"),
    enhanceBucket(startSit, "start-sit"),
    enhanceBucket(advice,   "advice"),
    enhanceBucket(dfs,      "dfs"),
    enhanceBucket(waivers,  "waiver-wire"),
    enhanceBucket(injuries, "injury"),
  ]);

  // 4) News & Updates: most recent leftovers from the pool (dynamic only)
  for (const r of leftovers) {
    if (latest.length >= limitNews) break;
    if (!placed.has(r.id)) {
      latest.push(toDbRow(r));
      placed.add(r.id);
    }
  }
  await enhanceBucket(latest, null);

  // 5) Optional Static section: strictly is_static=true, never used elsewhere here
  if (staticSectionLimit > 0 && staticRaw.length > 0) {
    // de-dupe against anything already placed by id just in case
    for (const r of staticRaw) {
      if (staticItems.length >= staticSectionLimit) break;
      if (placed.has(r.id)) continue;
      staticItems.push(r);
      placed.add(r.id);
    }
    await enhanceBucket(staticItems, null);
  }

  const heroCandidates = latest.slice(0, limitHero);

  const payload: HomePayload = {
    items: {
      latest,
      rankings,
      startSit,
      advice,
      dfs,
      waivers,
      injuries,
      heroCandidates,
      ...(staticSectionLimit > 0 ? { staticItems } : {}),
    },
  };

  return payload;
}
