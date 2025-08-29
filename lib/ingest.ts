// Ingestion with strict NFL filtering + safe player-page heuristics,
// resilient fetch (no throw on 404), resilient upsert (handles canonical_url conflicts),
// image hygiene + auto-seeding of player_images for future fallbacks,
// and robust ingest logging (ingest_logs).

import Parser from "rss-parser";
import * as cheerio from "cheerio";
import { dbQuery } from "@/lib/db";
import { allowItem, classifyLeagueCategory } from "@/lib/contentFilter";
import {
  FALLBACK,
  getSafeImageUrl,
  isWeakArticleImage,
  extractLikelyNameFromTitle,
} from "@/lib/images";
import { logIngest, logIngestError } from "@/lib/ingestLogs";

/* ───────────────────────── Types ───────────────────────── */

type SourceRow = {
  id: number;
  name: string | null;
  homepage_url: string | null;
  rss_url: string | null;
  sitemap_url: string | null;
  favicon_url: string | null;
  allowed: boolean | null;
  priority: number | null;
  created_at: string | null;
  category: string | null;
  sport: string | null;
  notes: string | null;
  scrape_path: string | null;
  scrape_selector: string | null;
  paywall: boolean | null;
};

type FeedItem = {
  title: string;
  link: string;
  description?: string | null;
  author?: string | null;
  publishedAt?: Date | null;
  imageUrl?: string | null;
};

export type UpsertResult = { inserted: number; updated: number; skipped: number };

type DbParam = string | number | boolean | Date | null;

type PgLikeError = { code?: string; detail?: string; message?: string };

type RssItem = {
  title?: string | null;
  link?: string | null;
  contentSnippet?: string | null;
  content?: string | null;
  summary?: string | null;
  creator?: string | null;
  author?: string | null;
  isoDate?: string | null;
  [k: string]: unknown;
};

const parser = new Parser({
  timeout: 15000,
  headers: { "user-agent": "FantasyReportBot/1.0 (+https://fantasy-report.vercel.app)" },
});

const DEFAULT_NFL_SELECTOR = 'a[href*="/nfl/"], a[href*="fantasy-football"]';


/* ───────────────────────── Public API ───────────────────────── */

export async function ingestAllSources(
  limitPerSource = 50
): Promise<Record<number, UpsertResult & { error?: string }>> {
  const srcs = await selectAllowedSources();
  const results: Record<number, UpsertResult & { error?: string }> = {};
  for (const src of srcs) {
    try {
      results[src.id] = await ingestSource(src, limitPerSource);
    } catch (e) {
      const msg = errString(e);
      console.warn(`[ingest][source ${src.id}] failed:`, msg);
      results[src.id] = { inserted: 0, updated: 0, skipped: 0, error: msg };
    }
  }
  return results;
}

export async function ingestSourceById(
  sourceId: number,
  limitPerSource = 50
): Promise<UpsertResult> {
  const res = await dbQuery<SourceRow>("select * from sources where id = $1", [sourceId]);
  if (res.rows.length === 0) return { inserted: 0, updated: 0, skipped: 0 };
  return ingestSource(res.rows[0], limitPerSource);
}

/* ───────────────────────── DB helpers ───────────────────────── */

async function selectAllowedSources(): Promise<SourceRow[]> {
  const res = await dbQuery<SourceRow>(
    "select * from sources where allowed = true order by coalesce(priority, 999), id asc"
  );
  return res.rows;
}

/* ───────────────────────── Ingest ───────────────────────── */

async function ingestSource(src: SourceRow, limitPerSource: number): Promise<UpsertResult> {
  const rawItems = await fetchForSource(src, limitPerSource);

  // Per-source/content filter
  const filtered = rawItems.filter((it) =>
    allowItem({ title: it.title, description: it.description ?? null, link: it.link }, String(src.id))
  );

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const item of filtered) {
    // Normalize title and classify
    const normalizedTitle = normalizeTitle(item.title);
    const { league, category } = classifyLeagueCategory({
      title: normalizedTitle,
      description: item.description ?? null,
      link: item.link,
    });

    // Only keep NFL
    if (league !== "NFL") {
      skipped += 1;
      continue;
    }

    // —— Player-page heuristics ——
    const titleIsName = looksLikeNameTitle(normalizedTitle);
    const titleStartsArrow = startsWithArrow(item.title);

    const slug = pickRightMostAlphaSlug(item.link);
    const slugIsName = slug ? /^[a-z]+(?:-[a-z]+){1,3}$/.test(slug) : false;

    const isPlayer = titleIsName || (titleStartsArrow && slugIsName);
    const parsedNameFromSlug = slugIsName && slug ? prettyFromSlug(slug) : null;

    // Only overwrite cleaned_title from slug when the title starts with "»"
    const cleanedTitle = titleStartsArrow && parsedNameFromSlug ? parsedNameFromSlug : normalizedTitle;

    const chosenTopic: string = isPlayer ? "Player" : category;

    // Domain & canonical
    const canonicalUrl = item.link;
    const domain = new URL(item.link).hostname.replace(/^www\./i, "");

    // Sanitize the incoming feed image
    const articleImageForDb = toDbImage(item.imageUrl);

    const vals: Readonly<[
      number,            // 1 source_id
      string,            // 2 url
      string,            // 3 canonical_url
      string,            // 4 title
      string | null,     // 5 author
      Date | null,       // 6 published_at
      string | null,     // 7 summary
      string | null,     // 8 image_url
      string,            // 9 sport
      string,            // 10 primary_topic
      string,            // 11 domain
      string,            // 12 cleaned_title
      boolean            // 13 is_player_page
    ]> = [
      src.id,
      item.link,
      canonicalUrl,
      item.title, // keep original in "title", store normalized in cleaned_title
      item.author ?? null,
      item.publishedAt ?? null,
      item.description ?? null,
      articleImageForDb,
      "NFL",
      chosenTopic,
      domain,
      cleanedTitle,
      isPlayer,
    ];

    // Resilient upsert
    const result = await upsertArticle(vals);

    if (result === "inserted") {
      inserted += 1;
      await logIngest({
        sourceId: src.id,
        sourceName: src.name ?? null,
        url: item.link,
        title: normalizedTitle,
        domain,
        reason: "ok_insert",
        detail: null,
      });
    } else if (result === "updated") {
      updated += 1;
      await logIngest({
        sourceId: src.id,
        sourceName: src.name ?? null,
        url: item.link,
        title: normalizedTitle,
        domain,
        reason: "ok_update",
        detail: null,
      });
    } else {
      skipped += 1;
    }

    // —— Seed player_images if we have a strong article image + likely player key ——
    const maybeName =
      (titleStartsArrow && parsedNameFromSlug) ||
      extractLikelyNameFromTitle(normalizedTitle) ||
      null;

    const playerKey = maybeName ? toPlayerKey(maybeName) : (slugIsName && slug ? slug : null);

    if (playerKey && articleImageForDb && !isWeakArticleImage(articleImageForDb)) {
      await upsertPlayerImage({
        key: playerKey,
        url: articleImageForDb,
        source: "article",
        source_rank: 0, // best
      });
    }
  }

  return { inserted, updated, skipped };
}

/* ───────────────────────── Upsert (resilient) ───────────────────────── */

async function upsertArticle(
  vals: Readonly<[number, string, string, string, string | null, Date | null, string | null, string | null, string, string, string, string, boolean]>
): Promise<"inserted" | "updated" | "skipped"> {
  try {
    const up = await dbQuery<{ inserted: boolean }>(
      `
      INSERT INTO articles (
        source_id, url, canonical_url, title, author, published_at, discovered_at,
        summary, image_url, sport, primary_topic, domain, cleaned_title, is_player_page
      ) VALUES (
        $1, $2, $3, $4, $5, $6, NOW(),
        $7, $8, $9, $10, $11, $12, $13
      )
      ON CONFLICT (url) DO UPDATE SET
        title          = EXCLUDED.title,
        author         = EXCLUDED.author,
        published_at   = EXCLUDED.published_at,
        summary        = EXCLUDED.summary,
        image_url      = EXCLUDED.image_url,
        sport          = EXCLUDED.sport,
        primary_topic  = EXCLUDED.primary_topic,
        domain         = EXCLUDED.domain,
        cleaned_title  = EXCLUDED.cleaned_title,
        is_player_page = EXCLUDED.is_player_page
      RETURNING (xmax = 0) as inserted
      `,
      vals as unknown as DbParam[]
    );
    return up.rows[0]?.inserted ? "inserted" : "updated";
  } catch (err: unknown) {
    // Unique violation on canonical_url? Update by canonical_url instead of failing.
    const e = (err ?? {}) as PgLikeError;
    const msg = String(e.message ?? "");
    const detail = String(e.detail ?? "");
    if (e.code === "23505" && (/canonical_url/i.test(msg) || /canonical_url/i.test(detail))) {
      await dbQuery(
        `
        UPDATE articles SET
          source_id      = $1,
          url            = $2,
          title          = $4,
          author         = $5,
          published_at   = $6,
          discovered_at  = NOW(),
          summary        = $7,
          image_url      = $8,
          sport          = $9,
          primary_topic  = $10,
          domain         = $11,
          cleaned_title  = $12,
          is_player_page = $13
        WHERE canonical_url = $3
        `,
        vals as unknown as DbParam[]
      );
      return "updated";
    }
    console.warn("[upsertArticle] failed:", errString(err));
    throw err; // let caller count this towards the source's error
  }
}

/* ───────────────────────── player_images upsert ───────────────────────── */

async function upsertPlayerImage(args: { key: string; url: string; source: string; source_rank: number }) {
  await dbQuery(
    `
    INSERT INTO player_images (key, url, source, source_rank, created_at, updated_at)
    VALUES ($1, $2, $3, $4, NOW(), NOW())
    ON CONFLICT (key) DO UPDATE
      SET
        url = CASE
                WHEN EXCLUDED.source_rank < player_images.source_rank THEN EXCLUDED.url
                ELSE player_images.url
              END,
        source = CASE
                   WHEN EXCLUDED.source_rank < player_images.source_rank THEN EXCLUDED.source
                   ELSE player_images.source
                 END,
        source_rank = LEAST(player_images.source_rank, EXCLUDED.source_rank),
        updated_at = NOW()
    `,
    [args.key, args.url, args.source, args.source_rank]
  );
}

/* ───────────────────────── Utilities ───────────────────────── */

function domainOf(u?: string | null): string | null {
  if (!u) return null;
  try {
    return new URL(u).hostname.replace(/^www\./i, "");
  } catch {
    return null;
  }
}

function isErrorWithMessage(x: unknown): x is { message: string } {
  return typeof x === "object" && x !== null && "message" in x && typeof (x as { message: unknown }).message === "string";
}

function errString(e: unknown): string {
  if (!e) return "Unknown error";
  if (isErrorWithMessage(e)) return e.message;
  try {
    return String(e);
  } catch {
    return "Unknown error";
  }
}

function toDbImage(raw?: string | null): string | null {
  const safe = getSafeImageUrl(raw);
  if (!safe || safe === FALLBACK) return null;
  if (isWeakArticleImage(safe)) return null;
  return safe;
}

function toPlayerKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function startsWithArrow(t: string): boolean {
  return /^\s*»/.test(t);
}

/** Title is likely just a name: 2–4 tokens; exclude article-y keywords. */
function looksLikeNameTitle(t: string): boolean {
  const s = t.trim();
  if (s.length < 3 || s.length > 48) return false;
  if (
    /(fantasy|waiver|rank|start|sit|news|injury|mock|sleep|week|vs\.|@|trade|odds|lines|score|highlights|report|rumor|notes|cheat|sheet|targets|snaps|analysis|preview|recap|podcast|video|live|bonus|code)/i.test(
      s
    )
  ) {
    return false;
  }
  return /^[A-Za-z][A-Za-z'.-]+( [A-Za-z][A-Za-z'.-]+){1,3}\s*(Jr\.|Sr\.|II|III|IV)?$/.test(s);
}

/**
 * Choose the right-most path segment that looks alphabetic (letters/dashes only),
 * skipping numeric/UUID segments and generic words (players/story/nfl/etc).
 */
function pickRightMostAlphaSlug(urlStr: string): string | null {
  try {
    const u = new URL(urlStr);
    const raw = u.pathname.replace(/\/+$/, "").replace(/_/g, "-").toLowerCase();
    const parts = raw.split("/").filter(Boolean);

    const skip = new Set([
      "news","story","article","id","nfl","football","sports","team","teams",
      "player","players","bio","athlete","people","video","videos","podcast",
      "bonus","code","codes","odds","lines","score","preview","recap"
    ]);

    for (let i = parts.length - 1; i >= 0; i--) {
      const seg = parts[i];
      if (skip.has(seg)) continue;
      if (!/^[a-z][a-z-]*$/.test(seg)) continue; // letters/dashes only
      return seg;
    }
    return null;
  } catch {
    return null;
  }
}

function prettyFromSlug(slug: string): string {
  let s = slug.replace(/-/g, " ");
  s = s.replace(/\b([a-z])/g, (m, c) => (c as string).toUpperCase());
  s = s.replace(/\bIii\b/g, "III").replace(/\bIi\b/g, "II").replace(/\bIv\b/g, "IV");
  return s;
}

/**
 * Minimal HTML-entity decode + trim + collapse + strip "NEWS" glue.
 */
function normalizeTitle(raw: string): string {
  if (!raw) return "";
  let s = decodeHtmlEntities(raw);
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/^NEWS[:\s-]+/i, "");
  s = s.replace(/^NEWS(?=[A-Z])/i, "");
  return s.trim();
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&#(\d+);?/g, (_, n: string) => {
      const code = parseInt(n, 10);
      return Number.isFinite(code) ? String.fromCharCode(code) : _;
    })
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—");
}

/* ───────────────────────── Fetchers ───────────────────────── */

const BROWSER_UA =
  process.env.SCRAPER_UA ??
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function fetchForSource(src: SourceRow, limit: number): Promise<FeedItem[]> {
  // 1) RSS first
  if (src.rss_url) {
    const rss = await readRss(src, limit);
    if (rss.length > 0) return rss;
  }

  // 2) Scrape (configured selector, then smart fallbacks)
  const homepageEff = buildEffectiveHomepageUrl(src.homepage_url, src.scrape_path);
  if (!homepageEff) return [];

  // Build a sequence of selectors to try, in order.
  const selectors = candidateSelectorsFor(src);

  const hits = await scrapeLinks(src, homepageEff, selectors, limit);
  if (hits.length > 0) return hits;

  return [];
}

function buildEffectiveHomepageUrl(homepage: string | null, path: string | null): string | null {
  if (!homepage) return null;
  try {
    const base = new URL(homepage);
    if (path && path.trim()) {
      return new URL(path, base).toString(); // supports relative or absolute
    }
    return base.toString();
  } catch {
    return homepage;
  }
}

async function readRss(src: SourceRow, limit: number): Promise<FeedItem[]> {
  try {
    const feed = await parser.parseURL(src.rss_url!);
    const items: FeedItem[] = [];
    for (const raw of feed.items.slice(0, limit)) {
      const it = raw as unknown as RssItem;
      const title = (it.title ?? "").trim();
      const link = (it.link ?? "").trim();
      if (!title || !link) {
        await logIngest({
          sourceId: src.id,
          sourceName: src.name ?? null,
          url: link || src.rss_url!,
          title: title || null,
          domain: domainOf(link || src.rss_url!),
          reason: "invalid_item",
          detail: "Missing title and/or link from RSS item",
        });
        continue;
      }
      items.push({
        title,
        link: normalizeLink(link),
        description: (it.contentSnippet ?? it.content ?? it.summary ?? null) || null,
        author: (it.creator ?? it.author ?? null) || null,
        publishedAt: it.isoDate ? new Date(it.isoDate) : null,
        imageUrl: extractImageFromItem(it as Record<string, unknown>),
      });
    }
    return items;
  } catch (e) {
    await logIngestError({
      sourceId: src.id,
      sourceName: src.name ?? null,
      url: src.rss_url,
      domain: domainOf(src.rss_url),
      reason: "fetch_error",
      detail: errString(e),
    });
    return [];
  }
}

/** A better fetch that looks like a browser so sites return SSR HTML. */
async function browserFetch(url: string): Promise<Response> {
  const origin = (() => {
    try {
      return new URL(url).origin;
    } catch {
      return undefined;
    }
  })();

  return fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent": BROWSER_UA,
      "accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      "cache-control": "no-cache",
      pragma: "no-cache",
      ...(origin ? { referer: origin } : {}),
    },
  });
}

/** Build ordered selectors to try for this source. */
function candidateSelectorsFor(src: SourceRow): string[] {
  const custom = (src.scrape_selector ?? "").trim();
  const list: string[] = [];

  if (custom) list.push(custom);

  // Common CMS patterns (headings, article cards, etc.)
  list.push(
    'h2 a[href^="/"]',
    'h3 a[href^="/"]',
    'article a[href^="/"]',
    'a.card[href^="/"]',
    // Fantasy-specific fallbacks
    'a[href*="/fantasy-football"]',
    'a[href*="/nfl/"]',
    'a[href^="/articles/"]',
    DEFAULT_NFL_SELECTOR
  );

  // Deduplicate while preserving order
  return Array.from(new Set(list));
}

/**
 * Try one or more selectors in order until we get links.
 * Accepts a single selector or a list of selectors.
 */
async function scrapeLinks(
  src: SourceRow,
  url: string,
  selectorOrList: string | string[],
  limit: number
): Promise<FeedItem[]> {
  const selectors = Array.isArray(selectorOrList) ? selectorOrList : [selectorOrList];

  let html: string | null = null;
  try {
    const res = await browserFetch(url);
    if (!res.ok) {
      await logIngestError({
        sourceId: src.id,
        sourceName: src.name ?? null,
        url,
        domain: domainOf(url),
        reason: "fetch_error",
        detail: `HTTP ${res.status}`,
      });
      return [];
    }
    html = await res.text();
  } catch (e) {
    await logIngestError({
      sourceId: src.id,
      sourceName: src.name ?? null,
      url,
      domain: domainOf(url),
      reason: "fetch_error",
      detail: errString(e),
    });
    return [];
  }

  const $ = cheerio.load(html);
  const seen = new Set<string>();

  // Try selectors in order. Stop when we have matches.
  for (const selector of selectors) {
    const items: FeedItem[] = [];

    $(selector).each((_, node) => {
      if (items.length >= limit) return;

      // Some selectors point to H2/H3 elements; grab closest <a>.
      const $el = $(node);
      const href =
        $el.attr("href") ||
        $el.closest("a").attr("href") ||
        $el.find("a[href]").first().attr("href");

      if (!href) return;

      const abs = absolutize(url, href);
      if (!abs) return;

      const normalized = normalizeLink(abs);
      if (seen.has(normalized)) return;

      // Skip category/tag/author/login/store/etc.
      if (looksLikeNonArticle(normalized)) return;

      // Pull a reasonable title: text of <a>, or element text fallback.
      let title = ($el.is("a") ? $el.text() : $el.find("a").first().text()) || $el.text();
      title = title.replace(/\s+/g, " ").trim();

      if (!title || title.length < 4) return;

      seen.add(normalized);
      items.push({
        title,
        link: normalized,
        description: null,
        publishedAt: null,
        author: null,
        imageUrl: null,
      });
    });

    if (items.length > 0) {
      return items.slice(0, limit);
    }
  }

  // Nothing matched; log once with the first selector we tried.
  await logIngestError({
    sourceId: src.id,
    sourceName: src.name ?? null,
    url,
    domain: domainOf(url),
    reason: "scrape_no_matches",
    detail: `Tried selectors: ${selectors.join(" | ")}`,
  });

  return [];
}

function absolutize(baseUrl: string, href: string | null | undefined): string | null {
  if (!href) return null;
  try {
    const u = new URL(href, baseUrl);
    return u.toString();
  } catch {
    return null;
  }
}

function normalizeLink(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    // strip tracking
    const toDelete: string[] = [];
    u.searchParams.forEach((_, k) => {
      if (/^utm_/i.test(k) || /^(gclid|ocid|mc_cid|mc_eid)$/i.test(k)) toDelete.push(k);
    });
    toDelete.forEach((k) => u.searchParams.delete(k));
    // collapse multiple slashes; drop trailing /amp
    u.pathname = u.pathname.replace(/\/+/g, "/").replace(/\/amp\/?$/i, "/");
    return u.toString();
  } catch {
    return raw;
  }
}

function looksLikeNonArticle(absUrl: string): boolean {
  try {
    const { pathname } = new URL(absUrl);
    const p = pathname.toLowerCase();
    // basic nav/category/user areas we don't want
    return (
      p.endsWith("/fantasy") || // a category hub itself
      p.includes("/tags/") ||
      p.includes("/tag/") ||
      p.includes("/category/") ||
      p.includes("/categories/") ||
      p.includes("/author/") ||
      p.includes("/authors/") ||
      p.includes("/login") ||
      p.includes("/signup") ||
      p.includes("/subscribe") ||
      p.includes("/store") ||
      p.includes("/shop") ||
      p.includes("/page/") // pagination landing
    );
  } catch {
    return false;
  }
}

function extractImageFromItem(it: Record<string, unknown>): string | null {
  const tryFields: ReadonlyArray<string> = ["enclosure", "image", "thumbnail"];
  for (const f of tryFields) {
    const v = it[f as keyof typeof it];
    if (!v) continue;
    if (typeof v === "object" && v !== null && "url" in (v as object)) {
      const url = (v as { url?: unknown }).url;
      if (typeof url === "string" && url) return url;
    }
    if (typeof v === "string" && v) return v;
  }
  return null;
}
