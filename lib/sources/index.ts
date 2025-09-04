// lib/sources/index.ts
import Parser from "rss-parser";
import * as cheerio from "cheerio";
import { URL } from "node:url";
import {
  ProbeRequest,
  ProbeResult,
  ProbeArticle,
  FeedCandidate,
  ScrapeCandidate,
  AdapterCandidate,
  Recommendation,
} from "./types";
import { ADAPTERS, fetchFromSitemap } from "./adapters";
import { enrichWithOG } from "./helpers";
import { allowItem as coreAllowItem} from "@/lib/contentFilter";
import { httpGet } from "./shared";
import { FeedItem, SourceConfig } from "./types"; 
import { dbQuery } from "../db";


type FeedLike = { title: string; link: string };

const allowItem = (x: FeedLike): boolean => coreAllowItem(x, x.link);

const rssParser = new Parser({ timeout: 15000 });

export async function runProbe(req: ProbeRequest): Promise<ProbeResult> {
  // Use the exact input URL as the page to analyze (keeps deep “series” paths)
  const page = normalizeBase(req.url);

  const feeds = await tryFeeds(page);
  const scrapes = await tryScrape(page);
  const adapters = await tryAdapters(page);

  const preview = await buildPreview(page, feeds, scrapes, adapters);
  const recommended = pickBest(page, feeds, scrapes, adapters);

  return {
    baseUrl: page.toString(),
    feeds,
    scrapes,
    adapters,
    preview,
    recommended,
  };
}

/* ---------------- Recommendation ---------------- */

function pickBest(
  page: URL,
  feeds: FeedCandidate[],
  scrapes: ScrapeCandidate[],
  adapters: AdapterCandidate[]
): Recommendation {
  // 1) Prefer a valid feed with the most items
  const bestFeed = feeds.filter((f) => f.ok).sort((a, b) => b.itemCount - a.itemCount)[0];
  if (bestFeed) {
    return {
      method: "rss",
      rationale: `Valid feed (${bestFeed.itemCount} items)`,
      feedUrl: bestFeed.feedUrl,
      suggestedUrl: page.toString(),
    };
  }

  // 2) Prefer an adapter if it produced items
  const bestAdapter = adapters.filter((a) => a.ok).sort((a, b) => b.itemCount - a.itemCount)[0];
  if (bestAdapter) {
    return {
      method: "adapter",
      rationale: `Adapter ${bestAdapter.label ?? bestAdapter.key} produced ${bestAdapter.itemCount} items`,
      suggestedUrl: page.toString(),
    };
  }

  // 3) Fall back to strongest scrape selector
  const bestScrape = scrapes.filter((s) => s.ok).sort((a, b) => b.linkCount - a.linkCount)[0];
  if (bestScrape) {
    // Suggest a cleaner URL when we recognize the host
    let suggestedUrl: string | null = page.toString();
    if (page.hostname.endsWith("nfl.com")) {
      // If they probed the site root, prefer /news; otherwise keep the exact listing/series URL
      suggestedUrl = page.pathname === "/" ? new URL("/news", page).toString() : page.toString();
    }
    return {
      method: "scrape",
      rationale: `Matched ${bestScrape.linkCount} links via selector ${bestScrape.selectorTried}`,
      selector: bestScrape.selectorTried,
      suggestedUrl,
    };
  }

  // 4) No signal anywhere
  return {
    method: "scrape",
    rationale: "No RSS/adapter match; try a custom selector.",
    suggestedUrl: page.toString(),
  };
}

/* ---------------- RSS ---------------- */

async function tryFeeds(base: URL): Promise<FeedCandidate[]> {
  const candidates = await discoverFeedUrls(base);
  const out: FeedCandidate[] = [];
  for (const feedUrl of candidates) {
    const res: FeedCandidate = { feedUrl, ok: false, itemCount: 0, sampleTitles: [], error: null };
    try {
      const feed = await rssParser.parseURL(feedUrl);
      const items = feed.items ?? [];
      res.ok = items.length > 0;
      res.itemCount = items.length;
      res.sampleTitles = items.slice(0, 5).map((i) => i.title ?? "").filter(Boolean);
    } catch (e) {
      res.error = e instanceof Error ? e.message : String(e);
    }
    out.push(res);
  }
  // dedupe by URL
  const seen = new Set<string>();
  return out.filter((f) => (seen.has(f.feedUrl) ? false : (seen.add(f.feedUrl), true)));
}

async function discoverFeedUrls(base: URL): Promise<string[]> {
  const set = new Set<string>([
    new URL("/feed", base.origin).toString(),
    new URL("/rss", base.origin).toString(),
    new URL("/rss.xml", base.origin).toString(),
    new URL("/atom.xml", base.origin).toString(),
    new URL("/index.xml", base.origin).toString(),
    new URL("/feed.xml", base.origin).toString(),
  ]);
  try {
    const html = await httpGet(base.toString());
    const $ = cheerio.load(html);
    $("link[rel='alternate'][type*='xml']").each((_i, el) => {
      const href = $(el).attr("href");
      if (href) set.add(new URL(href, base).toString());
    });
  } catch {
    /* ignore */
  }
  return Array.from(set);
}

/* ---------------- Scrape (host-aware) ---------------- */

async function tryScrape(page: URL): Promise<ScrapeCandidate[]> {
  const homepageUrl = page.toString();
  const html = await httpGet(homepageUrl);
  const $ = cheerio.load(html);

  // Host-aware selector sets
  const isNFL = page.hostname.endsWith("nfl.com");
  const selectors = isNFL
    ? [
        // Prefer links in the main content that go to /news/…
        "main a[href^='/news/']",
        "a[href^='https://www.nfl.com/news/']",
        // fallbacks
        "section a[href^='/news/']",
        "article a[href^='/news/']",
      ]
    : [
        // generic selectors for other sites
        "article a",
        "h2 a, h3 a",
        "main a",
      ];

  const out: ScrapeCandidate[] = [];
  for (const sel of selectors) {
    const urls: string[] = [];
    const titles: string[] = [];
    $(sel).each((_i, el) => {
      const href = ($(el).attr("href") ?? "").trim();
      if (!href) return;
      const abs = new URL(href, page).toString();
      if (!abs.startsWith(page.origin)) return;
      if (urls.includes(abs)) return;

      // Filter obvious non-articles
      if (/\/(videos|photos|tags|authors|teams)\//i.test(abs)) return;
      if (isNFL && !/\/news\//.test(abs)) return; // NFL: only keep /news/ stories

      urls.push(abs);
      const t = ($(el).text() || slugTitle(abs)).trim();
      titles.push(t);
    });

    out.push({
      homepageUrl,
      selectorTried: sel,
      ok: urls.length > 0,
      linkCount: urls.length,
      sampleUrls: urls.slice(0, 16),
      sampleTitles: titles.slice(0, 16),
      error: null,
    });
  }
  return out;
}

/* ---------------- Adapters ---------------- */

async function tryAdapters(base: URL): Promise<AdapterCandidate[]> {
  const matches = ADAPTERS.filter((a) => a.match(base));
  const out: AdapterCandidate[] = [];

  for (const a of matches) {
    try {
      const arts = await a.probePreview(base);
      out.push({
        key: a.key,
        label: a.label,
        ok: arts.length > 0,
        itemCount: arts.length,
        sampleTitles: arts.slice(0, 6).map((x) => x.title),
      });
    } catch (e) {
      out.push({
        key: a.key,
        label: a.label,
        ok: false,
        itemCount: 0,
        sampleTitles: [],
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return out;
}

/* ---------------- Preview builder ---------------- */

async function buildPreview(
  base: URL,
  feeds: FeedCandidate[],
  scrapes: ScrapeCandidate[],
  adapters: AdapterCandidate[]
): Promise<ProbeArticle[]> {
  const host = base.host;

  // 1) Prefer a working feed (parse & keep items allowed by contentFilter)
  const feed = feeds.filter((f) => f.ok).sort((a, b) => b.itemCount - a.itemCount)[0];
  if (feed) {
    try {
      const parsed = await rssParser.parseURL(feed.feedUrl);
      const items: ProbeArticle[] = [];
      for (const it of parsed.items ?? []) {
        const url = toAbs(it.link ?? "", base.origin);
        if (!url) continue;
        const title = (it.title ?? "").trim();
        if (!title || !allowItem({ title, link: url })) continue;
        items.push({
          title,
          url,
          author: (it.creator ?? it.author ?? null) as string | null,
          publishedAt: it.isoDate ?? (it.pubDate ? new Date(it.pubDate).toISOString() : null),
          imageUrl: (it.enclosure?.url as string | undefined) ?? null,
          sourceHost: host,
        });
      }
      if (items.length) return dedupe(items);
    } catch {
      /* ignore */
    }
  }

  // 2) Next, if any matching adapter produced items, use the best adapter (by itemCount)
  const bestAdapter = adapters.filter((a) => a.ok).sort((a, b) => b.itemCount - a.itemCount)[0];
  if (bestAdapter) {
    // re-run the adapter to get the actual articles (since candidates only had sampleTitles)
    const adapter = ADAPTERS.find((a) => a.key === bestAdapter.key)!;
    const arts = await adapter.probePreview(base);
    const filtered = arts.filter((a) => allowItem({ title: a.title, link: a.url }));
    if (filtered.length) return dedupe(filtered);
  }

  // 3) Finally, try scraping: enrich scraped URLs with OG tags
  const bestScrape = scrapes.filter((s) => s.ok).sort((a, b) => b.linkCount - a.linkCount)[0];
  if (bestScrape) {
    const enriched = await enrichWithOG(bestScrape.sampleUrls, host);
    const filtered = enriched.filter((a) => allowItem({ title: a.title, link: a.url }));
    if (filtered.length) return dedupe(filtered);
  }

  return [];
}

/* ---------------- misc ---------------- */

function normalizeBase(raw: string): URL {
  const u = new URL(raw);
  u.hash = "";
  u.search = "";
  if (u.protocol !== "https:") u.protocol = "https:";
  return u;
}

function slugTitle(u: string): string {
  try {
    const { pathname } = new URL(u);
    const last = pathname.split("/").filter(Boolean).pop() ?? "";
    return decodeURIComponent(last.replace(/[-_]/g, " ")).trim();
  } catch {
    return u;
  }
}

function toAbs(href: string, origin: string): string | null {
  try {
    const u = new URL(href, origin);
    return u.toString();
  } catch {
    return null;
  }
}

function dedupe(items: ProbeArticle[]): ProbeArticle[] {
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(i.url) ? false : (seen.add(i.url), true))).slice(0, 50);
}


async function loadSourceConfig(sourceId: number): Promise<SourceConfig | null> {
  const res = await dbQuery<SourceConfig>(
    `
    SELECT
      id,
      homepage_url,
      rss_url,
      sitemap_url,
      scrape_selector,
      COALESCE(adapter_config->>'adapter', NULL) AS adapter,
      COALESCE(fetch_mode, 'auto') AS fetch_mode
    FROM sources
    WHERE id = $1::int
    `,
    [sourceId]
  );

  const row = Array.isArray(res) ? (res as any)[0] : (res as any).rows?.[0];
  if (!row) return null;

  return {
    id: row.id,
    homepage_url: row.homepage_url ?? null,
    rss_url: row.rss_url ?? null,
    sitemap_url: row.sitemap_url ?? null,
    scrape_selector: row.scrape_selector ?? null,
    adapter: row.adapter ?? null,
    fetch_mode: (row.fetch_mode ?? "auto") as SourceConfig["fetch_mode"],
  };
}

/**
 * Tiny RSS parser (no external deps).
 * Extracts title, link, description, pubDate from <item> blocks.
 */
async function fetchRssItems(rssUrl: string, limit = 50): Promise<FeedItem[]> {
  const res = await fetch(rssUrl, { next: { revalidate: 0 } });
  if (!res.ok) return [];

  const xml = await res.text();

  const blocks = xml
    .split(/<item[\s>]/i)
    .slice(1)
    .map((chunk) => "<item " + chunk.split(/<\/item>/i)[0] + "</item>");

  const get = (rx: RegExp, s: string) => {
    const m = s.match(rx);
    return m ? m[1] : "";
  };
  const clean = (s: string) =>
    s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").trim();

  const items: FeedItem[] = [];
  for (const block of blocks) {
    // Prefer <link>, fallback to guid if it looks like a URL
    const rawLink = get(/<link[^>]*>([\s\S]*?)<\/link>/i, block) ||
      get(/<guid[^>]*>([\s\S]*?)<\/guid>/i, block);

    const link = clean(rawLink);
    if (!/^https?:\/\//i.test(link)) continue;

    const title = clean(get(/<title[^>]*>([\s\S]*?)<\/title>/i, block));
    const description = clean(get(/<description[^>]*>([\s\S]*?)<\/description>/i, block));
    const pubDate = clean(get(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i, block));

    items.push({
      title,
      link,
      description,
      publishedAt: pubDate ? new Date(pubDate).toISOString() : null,
    } as FeedItem);

    if (items.length >= limit) break;
  }

  return items;
}

export async function fetchItemsForSource(
  sourceId: number,
  limit: number
): Promise<FeedItem[]> {
  const cfg = await loadSourceConfig(sourceId);
  if (!cfg) return [];

  const mode = (cfg.fetch_mode ?? "auto").toLowerCase() as SourceConfig["fetch_mode"];

  // Explicit modes take priority
  if (mode === "rss" && cfg.rss_url) {
    return fetchRssItems(cfg.rss_url, limit);
  }
  if (mode === "sitemap" && cfg.sitemap_url) {
    return fetchFromSitemap(cfg.sitemap_url, limit);
  }
  // (mode === 'html') would go here when you add a homepage crawler.

  // AUTO: prefer RSS, then SITEMAP, then give up
  if (cfg.rss_url) {
    return fetchRssItems(cfg.rss_url, limit);
  }
  if (cfg.sitemap_url) {
    return fetchFromSitemap(cfg.sitemap_url, limit);
  }

  // No usable source
  return [];
}