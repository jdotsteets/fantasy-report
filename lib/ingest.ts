// lib/ingest.ts
import Parser from "rss-parser";
import * as cheerio from "cheerio";
import { allowItem, classifyLeagueCategory } from "@/lib/contentFilter";
import { dbQuery } from "@/lib/db";

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

type UpsertResult = {
  inserted: number;
  updated: number;
  skipped: number;
};

const parser = new Parser({
  timeout: 15000,
  headers: { "user-agent": "FantasyReportBot/1.0 (+https://fantasy-report.vercel.app)" },
});

/* ───────────── utility ───────────── */

function nameFromFantasyProsUrl(u: string): string | null {
  try {
    const url = new URL(u);
    if (!/fantasypros\.com$/i.test(url.hostname.replace(/^www\./i, ""))) return null;
    const m = url.pathname.match(/\/nfl\/(players|stats|news)\/([a-z0-9-]+)\.php$/i);
    if (!m) return null;
    const slug = m[2];
    const name = slug
      .split("-")
      .map((s) => (s ? s[0].toUpperCase() + s.slice(1) : s))
      .join(" ");
    return name || null;
  } catch {
    return null;
  }
}

function normalizeUrl(raw: string): string {
  const u = new URL(raw);
  const drop = new Set([
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "gclid",
    "fbclid",
  ]);
  for (const k of [...u.searchParams.keys()]) if (drop.has(k.toLowerCase())) u.searchParams.delete(k);
  return u.toString();
}

function stripHtml(raw: string): string {
  const noTags = raw.replace(/<[^>]*>/g, " ");
  return noTags
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&ldquo;|&rdquor;|&rdquo;/gi, '"')
    .replace(/&lsquo;|&rsquo;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanTitle(t: string): string {
  return stripHtml(t);
}
function cleanDescription(d: string | null | undefined): string | null {
  if (!d) return null;
  const s = stripHtml(d);
  return s.length ? s : null;
}

function absolutize(baseUrl: string, href: string): string | null {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

function extractImageFromItem(it: Record<string, unknown>): string | null {
  const tryFields: ReadonlyArray<string> = [
    "enclosure",
    "image",
    "thumbnail",
    "media:content",
    "media:thumbnail",
  ];
  for (const f of tryFields) {
    const v = it[f as keyof typeof it];
    if (!v) continue;
    if (typeof v === "object" && v !== null && "url" in v) {
      const url = (v as { url?: unknown }).url;
      if (typeof url === "string" && url) return url;
    }
    if (typeof v === "string" && v) return v;
  }
  const html =
    (typeof it["content:encoded"] === "string" && (it["content:encoded"] as string)) ||
    (typeof it["content"] === "string" && (it["content"] as string)) ||
    null;
  if (html) {
    try {
      const $ = cheerio.load(html);
      const src = $("img[src]").first().attr("src") ?? "";
      if (src) return src;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/* ───────────── logging ───────────── */

type SkipReason = "blocked_by_filter" | "non_nfl_league" | "invalid_item" | "fetch_error";

async function logSkip(
  sourceId: number,
  url: string,
  title: string,
  reason: SkipReason,
  detail?: string
): Promise<void> {
  await dbQuery("INSERT INTO ingest_skips (source_id, url, title, reason, detail) VALUES ($1,$2,$3,$4,$5)", [
    sourceId,
    url,
    title,
    reason,
    detail ?? null,
  ]);
}

/* ───────────── public api ───────────── */

export async function ingestAllSources(limitPerSource = 50): Promise<Record<number, UpsertResult>> {
  const srcs = await selectAllowedSources();
  const results: Record<number, UpsertResult> = {};
  for (const src of srcs) {
    results[src.id] = await ingestSource(src, limitPerSource);
  }
  return results;
}

export async function ingestSourceById(sourceId: number, limitPerSource = 50): Promise<UpsertResult> {
  const res = await dbQuery<SourceRow>("SELECT * FROM sources WHERE id = $1", [sourceId]);
  if (res.rows.length === 0) return { inserted: 0, updated: 0, skipped: 0 };
  return ingestSource(res.rows[0], limitPerSource);
}

async function selectAllowedSources(): Promise<SourceRow[]> {
  const res = await dbQuery<SourceRow>(
    "SELECT * FROM sources WHERE allowed = true ORDER BY COALESCE(priority, 999), id ASC"
  );
  return res.rows;
}

async function ingestSource(src: SourceRow, limitPerSource: number): Promise<UpsertResult> {
  let inserted = 0,
    updated = 0,
    skipped = 0;

  const rawItems = await fetchForSource(src, limitPerSource);

  // Iterate raw items so we can log each decision.
  for (const raw of rawItems) {
    const title = cleanTitle(raw.title ?? "");
    const link = raw.link ? normalizeUrl(raw.link) : "";
    const descr = cleanDescription(raw.description ?? null);

    if (!title || !link) {
      skipped += 1;
      await logSkip(
        src.id,
        link || raw.link || "(missing url)",
        title || raw.title || "(missing title)",
        "invalid_item",
        "missing title or link"
      );
      continue;
    }

    // Central filter (domain/path/title rules)
    const allowed = allowItem({ title, description: descr, link }, String(src.id));
    if (!allowed) {
      skipped += 1;
      await logSkip(src.id, link, title, "blocked_by_filter");
      continue;
    }

    // Categorize (NFL only)
    const { league, category } = classifyLeagueCategory({ title, description: descr, link });
    if (league !== "NFL") {
      skipped += 1;
      await logSkip(src.id, link, title, "non_nfl_league", league ?? "unknown");
      continue;
    }

    const canonicalUrl = link;
    const domain = new URL(link).hostname.replace(/^www\./i, "");

    // —— NEW: compute cleaned_title for FantasyPros player pages
    const fantasyName = nameFromFantasyProsUrl(link); // null unless /nfl/(players|stats|news)/<slug>.php
    const cleanedForInsert = fantasyName ?? title;

    const up = await dbQuery<{ inserted: boolean }>(
      `
      INSERT INTO articles (
        source_id, url, canonical_url, title, author, published_at, discovered_at,
        summary, image_url, sport, primary_topic, domain, cleaned_title
      ) VALUES (
        $1, $2, $3, $4, $5, $6, NOW(),
        $7, $8, $9, $10, $11, $12
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
        cleaned_title = EXCLUDED.cleaned_title
      RETURNING (xmax = 0) AS inserted
      `,
      [
        src.id,
        link,
        canonicalUrl,
        title, // keep original feed title (e.g., "» Stats") for provenance
        raw.author ?? null,
        raw.publishedAt ?? null,
        descr,
        raw.imageUrl ?? null,
        "NFL",
        category,
        domain,
        cleanedForInsert, // ← prefer FantasyPros player name, else sanitized title
      ]
    );

    const row = up.rows[0];
    if (row?.inserted) inserted += 1;
    else updated += 1;
  }

  return { inserted, updated, skipped };
}

/* ───────────── fetchers ───────────── */

async function fetchForSource(src: SourceRow, limit: number): Promise<FeedItem[]> {
  try {
    if (src.rss_url) return readRss(src.rss_url, limit);
    if (src.homepage_url && src.scrape_selector) return scrapeLinks(src.homepage_url, src.scrape_selector, limit);
  } catch {
    // log a fetch error for the source as a whole
    await logSkip(
      src.id,
      src.rss_url ?? src.homepage_url ?? "(no url)",
      src.name ?? "(source)",
      "fetch_error"
    );
  }
  return [];
}

async function readRss(rssUrl: string, limit: number): Promise<FeedItem[]> {
  const feed = await parser.parseURL(rssUrl);
  const items: FeedItem[] = [];
  for (const it of feed.items.slice(0, limit)) {
    const title = cleanTitle((it.title ?? "").trim());
    const linkRaw = (it.link ?? "").trim();
    if (!title || !linkRaw) continue;

    const link = normalizeUrl(linkRaw);
    const descText =
      (typeof it.contentSnippet === "string" && it.contentSnippet) ||
      (typeof it.content === "string" && it.content) ||
      (typeof it.summary === "string" && it.summary) ||
      null;

    items.push({
      title,
      link,
      description: cleanDescription(descText),
      author: (typeof it.creator === "string" && it.creator) || (typeof it.author === "string" && it.author) || null,
      publishedAt: it.isoDate ? new Date(it.isoDate) : null,
      imageUrl: extractImageFromItem(it as unknown as Record<string, unknown>),
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
    const titleRaw = ($(el).text() ?? "").trim();
    const title = cleanTitle(titleRaw);
    if (!href || !title) return;

    const link = absolutize(url, href);
    if (!link || seen.has(link)) return;
    seen.add(link);

    items.push({
      title,
      link: normalizeUrl(link),
      description: null,
      publishedAt: null,
      author: null,
      imageUrl: null,
    });
  });

  return items;
}
