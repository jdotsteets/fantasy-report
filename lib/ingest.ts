// lib/ingest.ts
// Ingest orchestrator + per-item ingest_logs, integrated with classify.ts.

import { dbQuery } from "@/lib/db";
import {
  appendEvent,
  setProgress,
  finishJobSuccess,
  failJob,
  type JobEventLevel,
} from "@/lib/jobs";

import { fetchItemsForSource } from "@/lib/sources/index";
import { classifyArticle, looksLikePlayerPage } from "@/lib/classify";
import { upsertPlayerImage } from "@/lib/ingestPlayerImages"; // keeps player_images logic separate
import { findArticleImage } from "@/lib/scrape-image";       // OG/Twitter/JSON-LD finder
import { isWeakArticleImage, extractPlayersFromTitleAndUrl, isLikelyAuthorHeadshot, unproxyNextImage } from "@/lib/images";
import { isUrlBlocked, blockUrl } from "@/lib/blocklist";

// ─────────────────────────────────────────────────────────────────────────────
// Optional helpers/adapters (scrape canonical, route, etc.)
// ─────────────────────────────────────────────────────────────────────────────
export const INGEST_ENGINE_VERSION = "2025-09-13";




type Adapters = {
  extractCanonicalUrl?: (url: string, html?: string) => Promise<string | null>;
  scrapeArticle?: (
    url: string
  ) => Promise<
    Partial<ArticleInput> & {
      canonical_url?: string | null;
      summary?: string | null;
      author?: string | null;
      image_url?: string | null;
      url?: string | null;
      published_at?: Date | string | null;
    }
  >;
  routeByUrl?: (
    url: string
  ) => Promise<{ kind: "article" | "index" | "skip"; reason?: string; section?: string }>;
};

function isPromise<T>(v: unknown): v is Promise<T> {
  return !!v && typeof (v as { then?: unknown }).then === "function";
}

type IngestDecision = { kind: "article" | "index" | "skip"; reason?: string; section?: string };



function normalizeDecision(v: unknown): IngestDecision {
  const k = (v as { kind?: unknown }).kind;
  const reason = (v as { reason?: unknown }).reason;
  const section = (v as { section?: unknown }).section;
  const kind: IngestDecision["kind"] =
    k === "article" || k === "index" || k === "skip" ? k : "article";
  return {
    kind,
    ...(typeof reason === "string" ? { reason } : {}),
    ...(typeof section === "string" ? { section } : {}),
  };
}

function toPlayerKey(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `nfl:name:${slug}`;
}

function looksUsableImage(u: string | null | undefined): u is string {
  if (!u) return false;

  const s = u.trim();
  if (!/^https?:\/\//i.test(s)) return false;           // only http(s)
  if (/\.svg(\?|#|$)/i.test(s)) return false;           // skip SVGs (logos/icons)

  // NEW: ban author/byline/avatars (e.g., USA Today gcdn authoring images, 48x48, etc.)
  if (isLikelyAuthorHeadshot(s)) return false;

  // Existing heuristic gate (tiny icons, favicons, etc.)
  return !isWeakArticleImage(s);
}

function normalizeImageForStorage(src?: string | null): string | null {
  const un = unproxyNextImage(src ?? null);
  if (!un) return null;
  if (isLikelyAuthorHeadshot(un)) return null;   // block bylines/avatars
  if (isWeakArticleImage(un)) return null;       // block favicons/tiny icons
  return un;
}

// replace the existing resolveFinalUrl with this:

async function resolveFinalUrl(input: string, timeoutMs = 8000): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // Try HEAD first
    let r = await fetch(input, { method: "HEAD", redirect: "follow", signal: ctrl.signal });
    if (!r.ok || !r.url) {
      // Fall back to GET (some hosts reject HEAD)
      r = await fetch(input, { method: "GET", redirect: "follow", signal: ctrl.signal });
    }
    return r.url || input;
  } catch (e) {
    // Surface a clear error message up the stack
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`resolveFinalUrl failed for ${input}: ${msg}`);
  } finally {
    clearTimeout(timer);
  }
}

function isLikelyDeadRedirect(u: URL): boolean {
  const host = u.hostname.toLowerCase();
  const path = u.pathname.replace(/\/+$/, "").toLowerCase(); // strip trailing slash
  // NumberFire → FanDuel soft redirects
  if (host === "www.fanduel.com" && (path === "" || path === "/research")) return true;
  // Generic “homepage” traps (extend as you see patterns)
  if (path === "" || path === "/") return true;
  return false;
}

async function loadAdapters(): Promise<Adapters> {
  // Lazy, best-effort dynamic imports without introducing 'any' at callsites.
  let extractCanonicalUrl: Adapters["extractCanonicalUrl"];
  let scrapeArticle: Adapters["scrapeArticle"];
  let routeByUrl: Adapters["routeByUrl"];

  try {
    const modUnknown: unknown = await import("./sources/adapters");
    const mod = modUnknown as Record<string, unknown>;

    const maybeScrape = mod["scrapeArticle"];
    if (typeof maybeScrape === "function") {
      scrapeArticle = maybeScrape as Adapters["scrapeArticle"];
    }

    const maybeExtract = mod["extractCanonicalUrl"];
    if (typeof maybeExtract === "function") {
      extractCanonicalUrl = maybeExtract as Adapters["extractCanonicalUrl"];
    }

    const maybeRoute = mod["routeByUrl"];
    if (typeof maybeRoute === "function") {
      const raw = maybeRoute as (...args: unknown[]) => unknown;
      routeByUrl = async (url: string) => {
        const out = raw(url);
        const val = isPromise<unknown>(out) ? await out : out;
        return normalizeDecision(val);
      };
    }
  } catch {
    /* optional module; ignore */
  }

  return { extractCanonicalUrl, scrapeArticle, routeByUrl };
}

// ─────────────────────────────────────────────────────────────────────────────
// Job-aware logger
// ─────────────────────────────────────────────────────────────────────────────
function mkLogger(jobId?: string) {
  const send = async (level: JobEventLevel, message: string, meta?: Record<string, unknown>) => {
    if (!jobId) return;
    try {
      await appendEvent(jobId, level, message, meta);
    } catch {
      /* noop */
    }
  };
  return {
    info: (m: string, meta?: Record<string, unknown>) => send("info", m, meta),
    warn: (m: string, meta?: Record<string, unknown>) => send("warn", m, meta),
    error: (m: string, meta?: Record<string, unknown>) => send("error", m, meta),
    debug: (m: string, meta?: Record<string, unknown>) => send("debug", m, meta),
  };
}

function inferWeekFromText(title: string | null, url: string): number | null {
  const hay = `${title ?? ""} ${url}`.toLowerCase();
  const m = hay.match(/\bweek\s*:?\s*(\d{1,2})\b/);
  return m ? Number(m[1]) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// DB helpers (articles)
// ─────────────────────────────────────────────────────────────────────────────


function rowsOf<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  const obj = res as { rows?: T[] };
  return Array.isArray(obj?.rows) ? (obj.rows as T[]) : [];
}


// lib/ingest.ts (replace this function)

export type UpsertResult =
  | { inserted: true; updated?: false }
  | { updated: true; inserted?: false };

type ArticleInput = {
  canonical_url?: string | null;
  url?: string | null;
  link?: string | null;

  source_id?: number | null;
  sourceId?: number | null;

  title?: string | null;
  author?: string | null;

  // Either of these may be provided by callers
  published_at?: string | Date | null;
  publishedAt?: string | Date | null;

  image_url?: string | null;
  domain?: string | null;
  sport?: string | null;

  topics?: string[] | null;
  primary_topic?: string | null;
  secondary_topic?: string | null;
  week?: number | null;
  players?: string[] | null;

  is_player_page?: boolean | null;
};

function pickNonEmpty<T extends string | null | undefined>(...vals: T[]): string | null {
  for (const v of vals) {
    if (typeof v === "string" && v.trim() !== "") return v;
  }
  return null;
}

// lib/ingest.ts

function isGenericCanonical(canon: string, original?: string | null): boolean {
  try {
    const cu = new URL(canon);
    const path = cu.pathname.replace(/\/+$/, "");
    const generic = new Set([
      "", "/", "/research", "/news", "/blog", "/articles",
      "/sports", "/nfl", "/fantasy", "/fantasy-football",
    ]);
    if (generic.has(path)) return true;

    if (original) {
      const ou = new URL(original);
      const cSeg = cu.pathname.split("/").filter(Boolean).length;
      const oSeg = ou.pathname.split("/").filter(Boolean).length;
      if (cu.host === ou.host && cSeg < 2 && oSeg >= 2) return true;
    }
  } catch {}
  return false;
}

/**
 * Pick a canonical URL, guaranteed non-null.
 * If the provided canonical looks like a generic section page,
 * fall back to the real page URL.
 */


export function chooseCanonical(
  rawCanonical: string | null | undefined,
  pageUrl: string | null | undefined
): string | null {
  const canon = (rawCanonical ?? "").trim() || null;
  const page  = (pageUrl ?? "").trim() || null;
  if (canon && !isGenericCanonical(canon, page)) return canon;
  return page; // fall back to the real page URL
}

function toDateOrNull(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === "string" && v.trim() !== "") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export async function upsertArticle(row: ArticleInput): Promise<UpsertResult> {
  // Prefer the real page URL; use canonical only as a hint
  const pageUrl = pickNonEmpty(row.url, row.link, row.canonical_url);
  if (!pageUrl) return { updated: true }; // nothing useful to write

  // Ensure canonical is a string; fall back to page URL when needed
  const canonical = chooseCanonical(row.canonical_url ?? null, pageUrl);
  const url = pageUrl;

  const publishedAt = toDateOrNull(row.publishedAt ?? row.published_at);

  // normalize arrays (empty -> null so NULLIF/text[] casts behave)
  const topicsArr  = Array.isArray(row.topics)  && row.topics.length  ? row.topics  : null;
  const playersArr = Array.isArray(row.players) && row.players.length ? row.players : null;

  const srcId        = row.source_id ?? row.sourceId ?? null;
  const isPlayerPage = row.is_player_page ?? null;

  // ONE image param: normalized before storage
  const imageUrl = normalizeImageForStorage(row.image_url ?? null);

  const params = [
    canonical,                 // $1  canonical_url
    url,                       // $2  url
    srcId,                     // $3  source_id
    row.title ?? null,         // $4  title
    row.author ?? null,        // $5  author
    publishedAt,               // $6  published_at ::timestamptz
    imageUrl,                  // $7  image_url
    row.domain ?? null,        // $8  domain
    row.sport ?? null,         // $9  sport
    topicsArr,                 // $10 topics ::text[]
    row.primary_topic ?? null, // $11 primary_topic
    row.secondary_topic ?? null, // $12 secondary_topic
    row.week ?? null,          // $13 week ::int
    playersArr,                // $14 players ::text[]
    isPlayerPage               // $15 is_player_page ::bool (nullable, coerced later)
  ];

  const sql = `
    INSERT INTO articles (
      canonical_url, url, source_id, title, author, published_at,
      image_url, domain, sport, discovered_at,
      topics, primary_topic, secondary_topic, week, players, is_player_page
    ) VALUES (
      $1::text, $2::text, $3::int,
      NULLIF($4::text,''), NULLIF($5::text,''),
      $6::timestamptz,
      NULLIF($7::text,''), NULLIF($8::text,''), NULLIF($9::text,''),
      NOW(),
      $10::text[], NULLIF($11::text,''), NULLIF($12::text,''), $13::int, $14::text[],
      COALESCE($15::bool, false)
    )
    ON CONFLICT (canonical_url)
    DO UPDATE SET
      url             = COALESCE(EXCLUDED.url, articles.url),
      title           = COALESCE(EXCLUDED.title, articles.title),
      author          = COALESCE(EXCLUDED.author, articles.author),
      published_at    = COALESCE(EXCLUDED.published_at, articles.published_at),
      image_url       = COALESCE(EXCLUDED.image_url, articles.image_url),
      domain          = COALESCE(EXCLUDED.domain, articles.domain),
      sport           = COALESCE(EXCLUDED.sport, articles.sport),
      topics          = COALESCE(EXCLUDED.topics, articles.topics),
      primary_topic   = COALESCE(EXCLUDED.primary_topic, articles.primary_topic),
      secondary_topic = COALESCE(EXCLUDED.secondary_topic, articles.secondary_topic),
      week            = COALESCE(EXCLUDED.week, articles.week),
      players         = COALESCE(EXCLUDED.players, articles.players),
      is_player_page  = articles.is_player_page OR COALESCE(EXCLUDED.is_player_page, false)
    RETURNING (xmax = 0) AS inserted;
  `;

  const res  = await dbQuery<{ inserted: boolean }>(sql, params);
  const rows = rowsOf<{ inserted: boolean }>(res);
  const inserted = !!rows?.[0]?.inserted;
  return inserted ? { inserted: true } : { updated: true };
}


// ─────────────────────────────────────────────────────────────────────────────
// Sources
// ─────────────────────────────────────────────────────────────────────────────
type SourceRow = {
  id: number;
  name: string | null;
  allowed: boolean | null;
  rss_url?: string | null;
  homepage_url?: string | null;
  scrape_selector?: string | null;
};

export async function getSource(sourceId: number): Promise<SourceRow | null> {
  const res = await dbQuery<SourceRow>(
    `SELECT id, name, allowed, rss_url, homepage_url, scrape_selector
     FROM sources WHERE id=$1`,
    [sourceId]
  );
  const rows = rowsOf<SourceRow>(res);
  return rows?.[0] ?? null;
}

export async function getAllowedSources(): Promise<SourceRow[]> {
  const res = await dbQuery<SourceRow>(
    `SELECT id, name, allowed, rss_url, homepage_url, scrape_selector
     FROM sources WHERE COALESCE(allowed, true) = true ORDER BY id ASC`,
    []
  );
  return rowsOf<SourceRow>(res);
}

// ─────────────────────────────────────────────────────────────────────────────
// ingest_logs writer (this is what the admin page reads)
// ─────────────────────────────────────────────────────────────────────────────
function hostnameOf(url: string | null | undefined) {
  try {
    return url ? new URL(url).hostname : null;
  } catch {
    return null;
  }
}

async function logIngest(
  src: SourceRow,
  reason: string,
  url?: string | null,
  opts?: { title?: string | null; detail?: string | null }
) {
  try {
    await dbQuery(
      `
      INSERT INTO ingest_logs
        (created_at, source_id, source, reason, url, domain, title, detail)
      VALUES
        (NOW(), $1::int, $2::text, $3::text,
         NULLIF($4::text,''), NULLIF($5::text,''), NULLIF($6::text,''), NULLIF($7::text,''))
      `,
      [
        src.id,
        src.name ?? null,
        reason,
        url ?? null,
        hostnameOf(url ?? null),
        opts?.title ?? null,
        opts?.detail ?? null,
      ]
    );
  } catch {
    // never fail ingest because of log write
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers: image backfill + players extraction
// ─────────────────────────────────────────────────────────────────────────────

/** After an upsert, if image is missing/weak, try to fetch a better one and persist. */
async function backfillArticleImage(
  articleId: number,
  canonicalUrl: string,
  currentImageUrl: string | null,
): Promise<string | null> {
  const hasUsable =
    !!currentImageUrl &&
    !isWeakArticleImage(currentImageUrl) &&
    !isLikelyAuthorHeadshot(currentImageUrl);
  if (hasUsable) return currentImageUrl;

  const raw = await findArticleImage(canonicalUrl);
  const best = normalizeImageForStorage(raw);

  if (!best) {
    await dbQuery(
      `UPDATE articles SET image_checked_at = NOW() WHERE id = $1`,
      [articleId]
    );
    return null;
  }

  await dbQuery(
    `UPDATE articles
       SET image_url = $2,
           image_source = CASE WHEN $2 IS NULL THEN image_source ELSE 'scraped' END,
           image_checked_at = NOW()
     WHERE id = $1`,
    [articleId, best]
  );
  return best;
}



// ─────────────────────────────────────────────────────────────────────────────
type IngestSummary = { total: number; inserted: number; updated: number; skipped: number };

function isLikelyIndexOrNonArticle(url: string) {
  const u = url.toLowerCase();
  return (
    u.includes("sitemap") ||
    u.endsWith("/videos") ||
    u.includes("/video/") ||
    u.includes("/category/") ||
    (u.endsWith("/") && u.split("/").filter(Boolean).length <= 2)
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// Non-NFL guard for specific sources (add IDs here only)
// ─────────────────────────────────────────────────────────────────────────────
export const NON_NFL_GUARD_SOURCE_IDS = new Set<number>([
  6,     // (example)
  3135,  // Yahoo source A
  3136,  // Yahoo source B
  3177,  // SI.com
]);

export function looksClearlyNFL(url: string, title?: string | null): boolean {
  const u = (url || "").toLowerCase();
  const t = (title || "").toLowerCase();

  // Accept if URL or title strongly hints NFL/fantasy football
  const okUrl =
    u.includes("/nfl/") ||
    u.includes("nfl") ||
    u.includes("fantasy%20football") ||
    u.includes("fantasy-football") ||
    u.includes("waiver") ||
    u.includes("fantasyfootball");

  const okTitle =
    t.includes("nfl") ||
    t.includes("fantasy football") ||
    t.includes("fantasy-football") ||
    t.includes("waiver") ||
    t.includes("fantasyfootball");

  return okUrl || okTitle;
}

export async function ingestSourceById(
  sourceId: number,
  opts?: { jobId?: string; limit?: number }
): Promise<IngestSummary> {
  const jobId = opts?.jobId;
  const limit = opts?.limit ?? 200;
  const log = mkLogger(jobId);
  const adapters = await loadAdapters();

  // Guard list (now includes 3136)
  const NON_NFL_GUARD_SOURCE_IDS = new Set<number>([6, 3135, 3136]);
  const looksClearlyNFL = (url: string, title?: string | null) => {
    const u = (url || "").toLowerCase();
    const t = (title || "").toLowerCase();
    const okUrl =
      u.includes("/nfl/") ||
      u.includes("nfl") ||
      u.includes("fantasy%20football") ||
      u.includes("fantasy-football") ||
      u.includes("fantasyfootball");
    const okTitle =
      t.includes("nfl") ||
      t.includes("fantasy football") ||
      t.includes("fantasy-football") ||
      t.includes("fantasyfootball");
    return okUrl || okTitle;
  };

  const src = await getSource(sourceId);
  if (!src) {
    await log.error("Unknown source", { sourceId });
    throw new Error(`Source ${sourceId} not found`);
  }

  await log.info("Ingest started", { sourceId, limit });
  if (jobId) {
    try { await setProgress(jobId, 0, limit); } catch {}
  }

  // 1) Candidate items
  await log.info("Fetching candidate items", { sourceId, limit });
  let items: Array<{ title: string; link: string; publishedAt?: Date | string | null }> = [];
  try {
    items = await fetchItemsForSource(sourceId, limit);
    await log.debug("Fetched feed items", { mode: "sources-index", count: items.length });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await log.error("Failed to fetch candidates", { sourceId, error: msg });
    items = [];
  }

  let inserted = 0, updated = 0, skipped = 0, processed = 0;

  for (const it of items) {
    processed++;
    if (jobId) {
      try { await setProgress(jobId, processed); } catch {}
    }

    const link = String(it?.link ?? "");
    const feedTitle = (it?.title ?? "").trim() || null;
    if (!link) {
      skipped++;
      await logIngest(src, "invalid_item", null, { detail: "empty link" });
      continue;
    }

    // Non-NFL guard
    if (NON_NFL_GUARD_SOURCE_IDS.has(src.id)) {
      if (!looksClearlyNFL(link, feedTitle)) {
        skipped++;
        await log.debug("non_nfl_guard: blocked", { sourceId: src.id, link, feedTitle });
        await logIngest(src, "blocked_by_filter", link, { title: feedTitle, detail: "non_nfl_guard" });
        continue;
      }
    }

    // Router / index checks
    await log.debug("Ingesting item", { link, feedTitle, sourceId });
    try {
      if (adapters.routeByUrl) {
        const routed = await adapters.routeByUrl(link);
        if (routed?.kind === "skip") {
          skipped++;
          await logIngest(src, "skip_router", link, { title: feedTitle, detail: routed?.reason ?? null });
          continue;
        }
        if (routed?.kind === "index") {
          skipped++;
          await logIngest(src, "skip_index", link, { title: feedTitle, detail: routed?.reason ?? null });
          continue;
        }
      } else if (isLikelyIndexOrNonArticle(link)) {
        skipped++;
        await logIngest(src, "skip_index", link, { title: feedTitle });
        continue;
      }
    } catch {
      /* best-effort router */
    }

let resolvedLink = link;
try {
  resolvedLink = await resolveFinalUrl(link);
  const resolvedUrl = new URL(resolvedLink);

  // keep this check, but scope it to hosts we know soft-redirect to homepages
  if (isLikelyDeadRedirect(resolvedUrl)) {
    skipped++;
    await logIngest(src, "dead_redirect", link, { title: feedTitle, detail: resolvedLink });
    continue;
  }
} catch (e) {
  // Do NOT kill the whole job — log and move on to the next item
  skipped++;
  await logIngest(src, "resolve_error", link, {
    title: feedTitle,
    detail: e instanceof Error ? e.message : String(e),
  });
  continue;
}


function isLikelyDeadRedirect(u: URL): boolean {
  const host = u.hostname.toLowerCase();
  const path = u.pathname.replace(/\/+$/, "").toLowerCase();
  // NumberFire → FanDuel soft redirects
  if (host.includes("fanduel.com")) return path === "" || path === "/research";
  return false;
}

// ✅ NEW: early block check (prevents scraping/work)
const earlyCanon = chooseCanonical(null, resolvedLink) ?? resolvedLink;
if (await isUrlBlocked(earlyCanon)) {
  skipped++;
  await logIngest(src, "blocked_by_admin", earlyCanon, { title: feedTitle });
  continue;
}

    // Normalize published_at
    let publishedAt: Date | null = null;
    const p = it?.publishedAt;
    if (p) {
      const d = new Date(p as string);
      if (!Number.isNaN(d.valueOf())) publishedAt = d;
    }

    // 2) Optional scrape enrich
    // Ensure canonical is *always* a string
    let canonical = chooseCanonical(null, resolvedLink) ?? resolvedLink;
    let chosenTitle = feedTitle;
    let chosenPlayers = extractPlayersFromTitleAndUrl(chosenTitle, canonical);

    try {
      if (adapters.scrapeArticle) {
        await log.debug("Calling scrapeArticle", { resolvedLink });
        const scraped = await adapters.scrapeArticle(resolvedLink);
        await log.debug("Scrape result", {
          link,
          gotCanonical: !!scraped?.canonical_url,
          gotTitle: !!scraped?.title,
          gotImage: !!scraped?.image_url,
        });

        // Use the real page URL for canonical fallback
        const pageUrl = scraped?.url ?? resolvedLink;
        canonical = chooseCanonical(scraped?.canonical_url ?? null, resolvedLink) ?? resolvedLink;

        if (!publishedAt && scraped?.published_at) {
          const d2 = new Date(scraped.published_at as string);
          if (!Number.isNaN(d2.valueOf())) publishedAt = d2;
        }
        if (scraped?.title) chosenTitle = scraped.title;

       if (await isUrlBlocked(canonical)) {
          skipped++;
          await logIngest(src, "blocked_by_admin", canonical, { title: feedTitle });
          continue;
        }

        // Re-extract players now that canonical may have changed
        chosenPlayers = extractPlayersFromTitleAndUrl(chosenTitle, canonical);
        

        const scrapedImage = normalizeImageForStorage(scraped?.image_url ?? null);



        const klass = classifyArticle({ title: chosenTitle, url: canonical });
        const isPlayerPage = looksLikePlayerPage(resolvedLink, chosenTitle ?? undefined);

        const res = await upsertArticle({
          canonical_url: canonical,
          url: resolvedLink,
          source_id: sourceId,
          title: chosenTitle,
          author: scraped?.author ?? null,
          published_at: publishedAt,
          image_url: scrapedImage,
          domain: hostnameOf(resolvedLink) ?? null,
          sport: "nfl",
          topics: klass.topics,
          primary_topic: klass.primary,
          secondary_topic: klass.secondary,
          week: inferWeekFromText(chosenTitle, canonical),
          players: chosenPlayers,
          is_player_page: isPlayerPage,
        });

        const action = res.inserted ? "ok_insert" : "ok_update";
        if (res.inserted) inserted++; else updated++;
        await logIngest(src, action, canonical, { title: chosenTitle });

        await backfillAfterUpsert(
          canonical,
          klass.primary,
          (chosenPlayers && chosenPlayers.length === 1) ? chosenPlayers[0] : null
        );

        if (chosenPlayers && chosenPlayers.length === 1 && looksUsableImage(scrapedImage)) {
          const key = `nfl:name:${chosenPlayers[0].trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
          await upsertPlayerImage({ key, url: scrapedImage! });
        }

        continue; // finished this item
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await log.warn("Scrape failed; falling back to basic upsert", { resolvedLink, error: msg });
      await logIngest(src, "parse_error", resolvedLink, { title: feedTitle, detail: msg });
    }

    // 3) Fallback (no scraper)
    canonical = chooseCanonical(null, resolvedLink) ?? resolvedLink;
    const klass = classifyArticle({ title: chosenTitle, url: canonical });

    const players = extractPlayersFromTitleAndUrl(chosenTitle, canonical);
    const isPlayerPage = looksLikePlayerPage(resolvedLink, feedTitle ?? undefined);

    const res = await upsertArticle({
      canonical_url: canonical,
      url: resolvedLink,
      source_id: sourceId,
      title: feedTitle,
      author: null,
      published_at: publishedAt,
      image_url: null,
      domain: hostnameOf(resolvedLink),
      sport: "nfl",
      topics: klass.topics,
      primary_topic: klass.primary,
      secondary_topic: klass.secondary,
      week: inferWeekFromText(chosenTitle, canonical),
      players,
      is_player_page: isPlayerPage,
    });

    const action = res.inserted ? "ok_insert" : "ok_update";
    if (res.inserted) inserted++; else updated++;
    await logIngest(src, action, canonical, { title: feedTitle });

    await backfillAfterUpsert(
      canonical,
      klass.primary,
      (players && players.length === 1) ? players[0] : null
    );
  }

  const summary = { total: items.length, inserted, updated, skipped };
  await log.info("Ingest summary", summary);
  return summary;

  async function backfillAfterUpsert(
    canon: string,
    _primaryTopic: string | null,
    possiblePlayerName?: string | null
  ) {
    const rs = await dbQuery<{ id: number; image_url: string | null }>(
      `SELECT id, image_url FROM articles WHERE canonical_url = $1`,
      [canon]
    );
    const row = rowsOf<{ id: number; image_url: string | null }>(rs)[0];
    if (!row) return;

    const best = await backfillArticleImage(row.id, canon, row.image_url);

    if (possiblePlayerName && looksUsableImage(best)) {
      const key = toPlayerKey(possiblePlayerName);
      await upsertPlayerImage({ key, url: best! });
    }
  }
}


export async function ingestAllAllowedSources(
  opts?: { jobId?: string; perSourceLimit?: number; concurrency?: number }
): Promise<void> {
  const jobId = opts?.jobId;
  const perSourceLimit = opts?.perSourceLimit ?? 50;
  const concurrency = Math.max(1, Math.min(opts?.concurrency ?? 3, 8)); // gentle on DB/pool
  const log = mkLogger(jobId);

  const sources = await getAllowedSources();
  await log.info("Starting ingest for allowed sources", {
    count: sources.length, perSourceLimit, concurrency
  });

  if (jobId) {
    try { await setProgress(jobId, 0, sources.length); } catch { /* noop */ }
  }
  if (sources.length === 0) {
    await log.info("No allowed sources found");
    return;
  }

  // roll-up totals (no `any`)
  let done = 0;
  const totals = { total: 0, inserted: 0, updated: 0, skipped: 0 };
  const errors: Array<{ sourceId: number; message: string }> = [];

  // simple worker pool
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const idx = cursor++;
      if (idx >= sources.length) break;
      const s = sources[idx];

      await log.info("Ingesting source", { name: s.name ?? `#${s.id}`, sourceId: s.id });
      try {
        const summary = await ingestSourceById(s.id, { jobId, limit: perSourceLimit });
        totals.total   += summary.total;
        totals.inserted+= summary.inserted;
        totals.updated += summary.updated;
        totals.skipped += summary.skipped;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({ sourceId: s.id, message: msg });
        await log.error("Source ingest failed", { sourceId: s.id, error: msg });
        await logIngest(s, "fetch_error", null, { detail: msg });
      } finally {
        done++;
        if (jobId) {
          try { await setProgress(jobId, done); } catch { /* noop */ }
        }
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  await log.info("All allowed sources finished", {
    sources: sources.length,
    totals,
    errors: errors.length,
  });
}

export async function ingestAllSources(
  opts?: { jobId?: string; perSourceLimit?: number }
): Promise<void> {
  const jobId = opts?.jobId;
  const perSourceLimit = opts?.perSourceLimit ?? 50;
  const log = mkLogger(jobId);

  const res = await dbQuery<SourceRow>(
    `SELECT id, name, allowed, rss_url, homepage_url, scrape_selector
     FROM sources ORDER BY id ASC`,
    []
  );
  const rows = rowsOf<SourceRow>(res);

  await log.info("Starting ingest for all sources", { count: rows.length, perSourceLimit });

  if (jobId) {
    try {
      await setProgress(jobId, 0, rows.length);
    } catch {
      /* noop */
    }
  }
  let done = 0;
  for (const s of rows) {
    await log.info("Ingesting source", { name: s.name ?? `#${s.id}`, sourceId: s.id });
    try {
      await ingestSourceById(s.id, { jobId, limit: perSourceLimit });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await log.error("Source ingest failed", { sourceId: s.id, error: msg });
      await logIngest(s, "fetch_error", null, { detail: msg });
    }
    done++;
    if (jobId) {
      try {
        await setProgress(jobId, done);
      } catch {
        /* noop */
      }
    }
  }

  await log.info("All sources finished", { count: rows.length });
}

// ─────────────────────────────────────────────────────────────────────────────
// Job wrappers
// ─────────────────────────────────────────────────────────────────────────────
export async function runSingleSourceIngestWithJob(sourceId: number, limit = 200) {
  const { createJob } = await import("@/lib/jobs");
  const job = await createJob("ingest", { sourceId, limit });
  try {
    const summary = await ingestSourceById(sourceId, { jobId: job.id, limit });
    await finishJobSuccess(job.id, "success");
    return { jobId: job.id, summary };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await failJob(job.id, msg);
    throw new Error(msg);
  }
}

export async function runAllAllowedSourcesIngestWithJob(perSourceLimit = 50) {
  const { createJob } = await import("@/lib/jobs");
  const job = await createJob("ingest", { scope: "allowed", perSourceLimit });
  try {
    await ingestAllAllowedSources({ jobId: job.id, perSourceLimit });
    await finishJobSuccess(job.id, "success");
    return { jobId: job.id };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await failJob(job.id, msg);
    throw new Error(msg);
  }
}
