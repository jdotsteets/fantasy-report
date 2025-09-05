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
import { FeedItem, ExistingSourceLite, ProbeMethod, SourceConfig } from "./types"; 
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


/** Create or update a source and switch to the selected ingestion method. Returns source id. */
export async function saveSourceWithMethod(args: {
  url: string;
  method: ProbeMethod;
  feedUrl?: string | null;
  selector?: string | null;
  adapterKey?: string | null;
  nameHint?: string | null;
  sourceId?: number;
  updates?: {
    name?: string;
    homepage_url?: string | null;
    rss_url?: string | null;
    sitemap_url?: string | null;
    scrape_selector?: string | null;
    scrape_path?: string | null;
    adapter_config?: Record<string, unknown> | null;
    allowed?: boolean | null;
    paywall?: boolean | null;
    category?: string | null;
    sport?: string | null;
    priority?: number | null;
  };
}): Promise<number> {
  const {
    url, method, feedUrl = null, selector = null, adapterKey = null,
    nameHint = null, sourceId, updates = {}
  } = args;

    // Canonical homepage: scheme + host + trailing slash
  const homepageOrigin = (() => {
      try { return new URL(url).origin + "/"; } catch { return url; }
    })();

  // Prepare a baseline update object from the method
  const u: Record<string, unknown> = {
    homepage_url: updates.homepage_url ?? homepageOrigin,
    // clear mutually exclusive fields
    rss_url: null,
    sitemap_url: updates.sitemap_url ?? null,
    scrape_selector: null,
    scrape_path: null,
    adapter_config: null,
    // passthrough optional updates
    name: updates.name ?? null,
    allowed: updates.allowed ?? null,
    paywall: updates.paywall ?? null,
    category: updates.category ?? null,
    sport: updates.sport ?? null,
    priority: updates.priority ?? null,
  };

  if (method === "rss") {
    u.rss_url = updates.rss_url ?? feedUrl ?? null;
  } else if (method === "scrape") {
    u.scrape_selector = updates.scrape_selector ?? selector ?? null;
    try { u.scrape_path = updates.scrape_path ?? new URL(url).pathname; } catch { u.scrape_path = updates.scrape_path ?? null; }
  } else if (method === "adapter") {
    u.adapter_config = updates.adapter_config ?? (adapterKey ? { key: adapterKey } : null);
  }

    const assignIf = <T>(key: string, val: T | undefined) => {
    if (val !== undefined) (u as Record<string, unknown>)[key] = val;
  };
  assignIf("name", updates.name);
  assignIf("allowed", updates.allowed);
  assignIf("paywall", updates.paywall);
  assignIf("category", updates.category);
  assignIf("sport", updates.sport);
  assignIf("priority", updates.priority);


  if (typeof sourceId === "number") {
    // UPDATE
    const fields = Object.keys(u).filter((k) => u[k] !== undefined);
    const setSql = fields.map((k, i) => `${k} = $${i + 2}`).join(", ");
    const sql = `update sources set ${setSql} where id = $1 returning id;`;
    const params = [sourceId, ...fields.map((k) => u[k])];
    const { rows } = await dbQuery<{ id: number }>(sql, params);
    return rows[0].id;
  }

  // INSERT
  if (updates.name === undefined && nameHint) {
  (u as Record<string, unknown>).name = nameHint;
  }



  const cols = Object.keys(u);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
  const sql = `insert into sources (${cols.join(", ")}) values (${placeholders}) returning id;`;
  const params = cols.map((k) => u[k]);
  const { rows } = await dbQuery<{ id: number }>(sql, params);
  const insertSql = `insert into sources (${cols.join(", ")}) values (${placeholders}) returning id;`;
  const insertParams = cols.map((k) => u[k]);

  try {
    const { rows } = await dbQuery<{ id: number }>(insertSql, insertParams);
    return rows[0].id;
  } catch (e) {
    // If homepage_url is unique and already exists, switch to UPDATE instead of failing.
    const err = e as { code?: string };
    if (err?.code === "23505") {
      const existing = await findExistingSourceByUrl(url);
      if (!existing) throw e;

      const fields = Object.keys(u).filter((k) => u[k] !== undefined);
      const setSql = fields.map((k, i) => `${k} = $${i + 2}`).join(", ");
      const updateSql = `update sources set ${setSql} where id = $1 returning id;`;
      const params = [existing.id, ...fields.map((k) => u[k])];
      const { rows } = await dbQuery<{ id: number }>(updateSql, params);
      return rows[0].id;
    }
    throw e;
  }
}

export async function findExistingSourceByUrl(inputUrl: string): Promise<ExistingSourceLite | null> {
  let host: string | null = null;
  try { host = new URL(inputUrl).host.replace(/^www\./i, ""); } catch { host = null; }
  if (!host) return null;

  // Extract hostname from a URL string in SQL:
  //   substring(url from '^(?:https?://)?(?:www\.)?([^/]+)') -> host
  // Then strip leading 'www.' if present, and compare to $1.
  const sql = `
    select id, name, homepage_url, rss_url, sitemap_url, scrape_selector, scrape_path, adapter_config
    from sources
    where
      lower(regexp_replace(substring(homepage_url from '^(?:https?://)?(?:www\\.)?([^/]+)'), '^www\\.', '', 'i')) = lower($1)
      or lower(regexp_replace(substring(rss_url      from '^(?:https?://)?(?:www\\.)?([^/]+)'), '^www\\.', '', 'i')) = lower($1)
      or lower(regexp_replace(substring(sitemap_url  from '^(?:https?://)?(?:www\\.)?([^/]+)'), '^www\\.', '', 'i')) = lower($1)
    order by id asc
    limit 1;
  `;
  const { rows } = await dbQuery<ExistingSourceLite>(sql, [host]);
  return rows[0] ?? null;
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

function sameHost(a: string, b: string) {
  try {
    const ha = new URL(a).hostname.replace(/^www\./i, "");
    const hb = new URL(b).hostname.replace(/^www\./i, "");
    return ha === hb;
  } catch { return false; }
}



const BAD_SCHEMES = /^(javascript:|mailto:|tel:)/i;

async function scrapeHomepage(cfg: SourceConfig, limit: number): Promise<FeedItem[]> {
  if (!cfg.homepage_url) return [];
  const base = new URL(cfg.homepage_url);
  const html = await httpGet(base.toString());
  const $ = cheerio.load(html);

  // prefer user-provided selector; otherwise generic set
  const selector = (cfg.scrape_selector && cfg.scrape_selector.trim())
    ? cfg.scrape_selector
    : "article a[href], h2 a[href], h3 a[href], main a[href]";

  const seen = new Set<string>();
  const out: FeedItem[] = [];

  $(selector).each((_i, el) => {
    const raw = ($(el).attr("href") || "").trim();
    if (!raw) return;
    let abs: string;
    try { abs = new URL(raw, base).toString(); } catch { return; }
    if (BAD_SCHEMES.test(abs)) return;
    if (!sameHost(abs, base.toString())) return;

    const text = (($(el).text() || "") as string).trim();
    const title = text || slugTitle(abs);
    if (!title) return;

    // run through your content filter
    if (!coreAllowItem({ title, link: abs }, abs)) return;

    if (!seen.has(abs)) {
      seen.add(abs);
      out.push({ title, link: abs, publishedAt: null });
    }
  });

  // If we scraped nothing, try to enrich homepage links via OG as last resort
  if (out.length === 0) {
    try {
      const enriched = await enrichWithOG([cfg.homepage_url], base.host); // returns articles for discovered links
      for (const a of enriched) {
        if (!a.url || !sameHost(a.url, base.toString())) continue;
        const title = a.title || slugTitle(a.url);
        if (!title) continue;
        if (!coreAllowItem({ title, link: a.url }, a.url)) continue;
        if (!seen.has(a.url)) {
          seen.add(a.url);
        const publishedAt = a.publishedAt ? new Date(a.publishedAt) : null;
              out.push({ title, link: a.url, publishedAt } as FeedItem);
        }
        if (out.length >= limit) break;
      }
    } catch { /* ignore */ }
  }

  return out.slice(0, limit);
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

export async function fetchItemsForSource(sourceId: number, limit: number): Promise<FeedItem[]> {
  const cfg = await loadSourceConfig(sourceId);
  if (!cfg) return [];

  const mode = (cfg.fetch_mode ?? "auto").toLowerCase() as SourceConfig["fetch_mode"];

  // 0) If an explicit adapter is configured, prefer it first.
  if (cfg.adapter) {
    const base = cfg.homepage_url ? new URL(cfg.homepage_url) : null;
    const adapter = ADAPTERS.find((a) => a.key === cfg.adapter);
    if (adapter && base) {
      try {
        const arts = await adapter.probePreview(base);
        const items = arts
          .filter((a) => coreAllowItem({ title: a.title, link: a.url }, a.url))
          .map((a) => ({ title: a.title, link: a.url, publishedAt: a.publishedAt ? new Date(a.publishedAt) : null}));
        if (items.length) return items.slice(0, limit);
      } catch { /* fall through */ }
    }
  }

  // 1) Explicit modes
  if (mode === "rss"     && cfg.rss_url)     return fetchRssItems(cfg.rss_url, limit);
  if (mode === "sitemap" && cfg.sitemap_url) return fetchFromSitemap(cfg.sitemap_url, limit);

  // 2) AUTO: if site gives us RSS, use it; otherwise SCRAPE; finally sitemap.
  if (cfg.rss_url) {
    const items = await fetchRssItems(cfg.rss_url, limit);
    if (items.length) return items;
  }

  // ← THIS IS THE NEW BEHAVIOR YOU WANTED
  if (cfg.homepage_url) {
    const items = await scrapeHomepage(cfg, limit);
    if (items.length) return items;
  }

  if (cfg.sitemap_url) {
    const items = await fetchFromSitemap(cfg.sitemap_url, limit);
    if (items.length) return items;
  }

  // 3) As last resort, try discovering RSS off homepage (auto-discover)
  if (cfg.homepage_url) {
    try {
      const candidates = await discoverFeedUrls(new URL(cfg.homepage_url));
      for (const u of candidates) {
        const items = await fetchRssItems(u, limit);
        if (items.length) return items;
      }
    } catch { /* ignore */ }
  }

  return [];
}