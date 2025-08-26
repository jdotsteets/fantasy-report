// lib/ingest.ts
// End-to-end typed ingestion with NFL/Fantasy filtering and DB upsert.
// Uses dbQuery/from lib/db.ts (no direct pool usage).

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

export async function ingestAllSources(limitPerSource = 50): Promise<Record<number, UpsertResult>> {
  const srcs = await selectAllowedSources();
  const results: Record<number, UpsertResult> = {};
  for (const src of srcs) {
    results[src.id] = await ingestSource(src, limitPerSource);
  }
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
  const filtered = rawItems.filter((it) =>
    allowItem({ title: it.title, description: it.description ?? null, link: it.link }, src.id.toString())
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

    if (league !== "NFL") {
      skipped += 1;
      continue;
    }

    const canonicalUrl = item.link;
    const domain = new URL(item.link).hostname.replace(/^www\./i, "");

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
        "NFL",            // sport
        category,         // primary_topic
        domain,
        cleanTitle(item.title),
      ]
    );

    const row = up.rows[0];
    if (row?.inserted) inserted += 1;
    else updated += 1;
  }

  return { inserted, updated, skipped };
}

function cleanTitle(t: string): string {
  return t.replace(/\s+/g, " ").trim();
}

// ———————————————————————————————————————————
// Fetchers
// ———————————————————————————————————————————

async function fetchForSource(src: SourceRow, limit: number): Promise<FeedItem[]> {
  if (src.rss_url) {
    return readRss(src.rss_url, limit);
  }
  if (src.homepage_url && src.scrape_selector) {
    return scrapeLinks(src.homepage_url, src.scrape_selector, limit);
  }
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
      imageUrl: extractImageFromItem(it),
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

// Narrow, typed extraction (no `any`)
function extractImageFromItem(it: Record<string, unknown>): string | null {
  const tryFields: ReadonlyArray<string> = ["enclosure", "image", "thumbnail"];
  for (const f of tryFields) {
    const v = it[f as keyof typeof it];
    if (!v) continue;
    if (typeof v === "object" && v !== null && "url" in v) {
      const url = (v as { url?: unknown }).url;
      if (typeof url === "string" && url) return url;
    }
    if (typeof v === "string" && v) return v;
  }
  return null;
}
