// lib/ingest.ts
// Ingestion with strict NFL filtering + safe player-page heuristics.
// Uses dbQuery from lib/db.ts (no `any` types).

import Parser from "rss-parser";
import * as cheerio from "cheerio";
import { dbQuery } from "@/lib/db";
import { allowItem, classifyLeagueCategory } from "@/lib/contentFilter";

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

type UpsertResult = { inserted: number; updated: number; skipped: number };

const parser = new Parser({
  timeout: 15000,
  headers: { "user-agent": "FantasyReportBot/1.0 (+https://fantasy-report.vercel.app)" },
});

export async function ingestAllSources(limitPerSource = 50): Promise<Record<number, UpsertResult>> {
  const srcs = await selectAllowedSources();
  const results: Record<number, UpsertResult> = {};
  for (const src of srcs) results[src.id] = await ingestSource(src, limitPerSource);
  return results;
}

export async function ingestSourceById(sourceId: number, limitPerSource = 50): Promise<UpsertResult> {
  const res = await dbQuery<SourceRow>("select * from sources where id = $1", [sourceId]);
  if (res.rows.length === 0) return { inserted: 0, updated: 0, skipped: 0 };
  return ingestSource(res.rows[0], limitPerSource);
}

async function selectAllowedSources(): Promise<SourceRow[]> {
  const res = await dbQuery<SourceRow>(
    "select * from sources where allowed = true order by coalesce(priority, 999), id asc"
  );
  return res.rows;
}

async function ingestSource(src: SourceRow, limitPerSource: number): Promise<UpsertResult> {
  const rawItems = await fetchForSource(src, limitPerSource);

  // Per-source/content filter (keeps ESPN scoreboard, USA Today non-NFL, etc. out)
  const filtered = rawItems.filter((it) =>
    allowItem({ title: it.title, description: it.description ?? null, link: it.link }, String(src.id))
  );

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const item of filtered) {
    const { league, category } = classifyLeagueCategory({
      title: item.title,
      description: item.description ?? null,
      link: item.link,
    });

    // Only keep NFL
    if (league !== "NFL") {
      skipped += 1;
      continue;
    }

    // —— Player-page heuristics (strict, low false positives) ——————————
    const titleIsName = looksLikeNameTitle(item.title);
    const titleStartsArrow = startsWithArrow(item.title);
    const slug = pickRightMostAlphaSlug(item.link);
    const slugIsName = slug ? /^[a-z]+(?:-[a-z]+){1,3}$/.test(slug) : false;

    const isPlayer = titleIsName || (titleStartsArrow && slugIsName);
    const parsedName = slugIsName && slug ? prettyFromSlug(slug) : null;

    // Only overwrite cleaned_title from slug when the title starts with "»"
    const cleanedTitle = titleStartsArrow && parsedName ? parsedName : cleanTitle(item.title);
    const chosenTopic: string = isPlayer ? "Player" : category;

    const canonicalUrl = item.link;
    const domain = new URL(item.link).hostname.replace(/^www\./i, "");

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
        title = EXCLUDED.title,
        author = EXCLUDED.author,
        published_at = EXCLUDED.published_at,
        summary = EXCLUDED.summary,
        image_url = EXCLUDED.image_url,
        sport = EXCLUDED.sport,
        primary_topic = EXCLUDED.primary_topic,
        domain = EXCLUDED.domain,
        cleaned_title = EXCLUDED.cleaned_title,
        is_player_page = EXCLUDED.is_player_page
      RETURNING (xmax = 0) as inserted
      `,
      [
        src.id,
        item.link,
        canonicalUrl,
        item.title,
        item.author ?? null,
        item.publishedAt ?? null,
        item.description ?? null,
        item.imageUrl ?? null,
        "NFL",
        chosenTopic,
        domain,
        cleanedTitle,
        isPlayer,
      ]
    );

    const row = up.rows[0];
    if (row?.inserted) inserted += 1;
    else updated += 1;
  }

  return { inserted, updated, skipped };
}

// ——— Helpers ————————————————————————————————————————————————

function cleanTitle(t: string): string {
  return t.replace(/\s+/g, " ").trim();
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
      "news",
      "story",
      "article",
      "id",
      "nfl",
      "football",
      "sports",
      "team",
      "teams",
      "player",
      "players",
      "bio",
      "athlete",
      "people",
      "video",
      "videos",
      "podcast",
      "bonus",
      "code",
      "codes",
      "odds",
      "lines",
      "score",
      "preview",
      "recap",
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
  // “de-von-achane” -> “De Von Achane”, normalize II/III/IV
  let s = slug.replace(/-/g, " ");
  s = s.replace(/\b([a-z])/g, (m, c) => c.toUpperCase());
  s = s.replace(/\bIii\b/g, "III").replace(/\bIi\b/g, "II").replace(/\bIv\b/g, "IV");
  return s;
}

// ——— Fetchers ————————————————————————————————————————————————

async function fetchForSource(src: SourceRow, limit: number): Promise<FeedItem[]> {
  if (src.rss_url) return readRss(src.rss_url, limit);
  if (src.homepage_url && src.scrape_selector) return scrapeLinks(src.homepage_url, src.scrape_selector, limit);
  return [];
}

async function readRss(rssUrl: string, limit: number): Promise<FeedItem[]> {
  const feed = await parser.parseURL(rssUrl);
  const items: FeedItem[] = [];
  for (const it of feed.items.slice(0, limit)) {
    const title = (it.title ?? "").trim();
    const link = (it.link ?? "").trim();
    if (!title || !link) continue;
    items.push({
      title,
      link,
      description: (it.contentSnippet ?? it.content ?? it.summary ?? null) || null,
      author: (it.creator ?? it.author ?? null) || null,
      publishedAt: it.isoDate ? new Date(it.isoDate) : null,
      imageUrl: extractImageFromItem(it as Record<string, unknown>),
    });
  }
  return items;
}

async function scrapeLinks(url: string, selector: string, limit: number): Promise<FeedItem[]> {
  const res = await fetch(url, { headers: { "user-agent": "FantasyReportBot/1.0" } });
  const html = await res.text();
  const $ = cheerio.load(html);
  const items: FeedItem[] = [];
  const seen = new Set<string>();

  $(selector).each((_, el) => {
    if (items.length >= limit) return;
    const href = $(el).attr("href") ?? "";
    const title = ($(el).text() ?? "").trim();
    if (!href || !title) return;

    const link = absolutize(url, href);
    if (!link || seen.has(link)) return;
    seen.add(link);

    items.push({
      title,
      link,
      description: null,
      publishedAt: null,
      author: null,
      imageUrl: null,
    });
  });

  return items;
}

function absolutize(baseUrl: string, href: string): string | null {
  try {
    const u = new URL(href, baseUrl);
    return u.toString();
  } catch {
    return null;
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
