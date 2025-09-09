// lib/sources/index.ts
import Parser from "rss-parser";
import * as cheerio from "cheerio";
import { URL } from "node:url";
import {
  ProbeRequest,
  FeedItem,
  SourceConfig,
  ExistingSourceLite,
  ProbeMethod,      // "rss" | "adapter" | "scrape"
  ProbeResult,
  ProbeArticle,
  FeedCandidate,
  ScrapeCandidate,
  AdapterCandidate,
  Recommendation,
} from "./types";
import { ADAPTERS, fetchFromSitemap } from "./adapters";
import { enrichWithOG } from "./helpers";
import { allowItem as coreAllowItem } from "@/lib/contentFilter";
import { httpGet } from "./shared";
import { dbQuery } from "../db";

/* ---------------- shared ---------------- */

type FeedLike = { title: string; link: string };
const rssParser = new Parser({ timeout: 15000 });

const allowItem = (x: FeedLike): boolean => coreAllowItem(x, x.link);

/* ============================================================================
   PROBE
============================================================================ */

export async function runProbe(req: ProbeRequest): Promise<ProbeResult> {
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

/* ============================================================================
   SAVE SOURCE (sets fetch_mode + relevant fields)
============================================================================ */

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
    adapter?: string | null; // explicit adapter column if you keep one
    adapter_config?: Record<string, unknown> | null;
    allowed?: boolean | null;
    paywall?: boolean | null;
    category?: string | null;
    sport?: string | null;
    priority?: number | null;
    fetch_mode?: ProbeMethod | "auto" | null;
        adapter_endpoint?: {
      kind: "page" | "sitemap";
      url: string;
      selector?: string | null;
    } | null;
  };
}): Promise<number> {
  const {
    url,
    method,
    feedUrl = null,
    selector = null,
    adapterKey = null,
    nameHint = null,
    sourceId,
    updates = {},
  } = args;

  const adapterEndpoint = updates.adapter_endpoint ?? null;

  const homepageOrigin = (() => {
    try {
      return new URL(url).origin + "/";
    } catch {
      return url;
    }
  })();

  // Build an update payload u with only fields we want to write.
  // (We add method-specific clears below so switching methods doesn't leave stale config.)
  const u: Record<string, unknown> = {};

    if (method === "adapter" && adapterEndpoint && typeof sourceId === "number" && sourceId > 0) {
    const cur = await dbQuery<{ adapter_config: any }>(
      "SELECT adapter_config FROM sources WHERE id = $1",
      [sourceId]
    );
    const cfg = (cur.rows[0]?.adapter_config ?? {}) as any;
    const list: any[] = Array.isArray(cfg.endpoints) ? cfg.endpoints : [];
    const exists = list.some(
      (e) =>
        e?.kind === adapterEndpoint.kind &&
        e?.url === adapterEndpoint.url &&
        (e?.selector ?? null) === (adapterEndpoint.selector ?? null)
    );
    if (!exists) list.push(adapterEndpoint);
    cfg.endpoints = list;

    await dbQuery(
      `UPDATE sources
         SET adapter_config = $1::jsonb,
             fetch_mode = 'adapter'
       WHERE id = $2`,
      [JSON.stringify(cfg), sourceId]
    );
    return sourceId; // ✅ done
  }

  // Base / general fields — only set if provided (avoid clobbering on update).
  if (updates.homepage_url !== undefined) u.homepage_url = updates.homepage_url;
  else if (!sourceId) u.homepage_url = homepageOrigin; // INSERT default

  if (updates.sitemap_url !== undefined) u.sitemap_url = updates.sitemap_url;

  if (updates.name !== undefined) u.name = updates.name;
  else if (!sourceId && nameHint) u.name = nameHint; // INSERT only

  if (updates.allowed !== undefined) u.allowed = updates.allowed;
  if (updates.paywall !== undefined) u.paywall = updates.paywall;
  if (updates.category !== undefined) u.category = updates.category;
  if (updates.sport !== undefined) u.sport = updates.sport;
  if (updates.priority !== undefined) u.priority = updates.priority;

  // Fetch mode: caller wins if explicitly set; else use the selected method.
  u.fetch_mode = updates.fetch_mode !== undefined ? updates.fetch_mode : method;

  // ─────────────────────────────────────────────────────
  // Clear mutually exclusive fields for the chosen method
  // (so a switch from rss→scrape or adapter cleans old config)
  // ─────────────────────────────────────────────────────
  // We always write these clears on UPDATE/INSERT to keep the row coherent.
  u.rss_url = null;
  u.scrape_selector = null;
  u.scrape_path = null;
  u.adapter = null;
  u.adapter_config = null;

  // Then populate the fields relevant to the chosen method.
  if (method === "rss") {
    // Respect explicit updates.rss_url > picked feedUrl
    const chosen = updates.rss_url !== undefined ? updates.rss_url : feedUrl;
    if (chosen != null) u.rss_url = chosen;
  } else if (method === "scrape") {
    const chosenSel =
      updates.scrape_selector !== undefined ? updates.scrape_selector : selector;
    if (chosenSel != null) u.scrape_selector = chosenSel;

    const chosenPath =
      updates.scrape_path !== undefined
        ? updates.scrape_path
        : (() => {
            try {
              return new URL(url).pathname || null;
            } catch {
              return null;
            }
          })();
    if (chosenPath != null) u.scrape_path = chosenPath;
  } else if (method === "adapter") {
    const key =
      updates.adapter !== undefined
        ? updates.adapter
        : adapterKey ?? null;

    if (key != null) u.adapter = key;
    // If caller supplied a full adapter_config, use it; else store a simple {key}.
    u.adapter_config =
      updates.adapter_config !== undefined
        ? updates.adapter_config
        : key
        ? { key }
        : null;
  }

  // Helper: run UPDATE with the keys we actually set in u
  async function runUpdate(id: number): Promise<number> {
    const fields = Object.keys(u);
    if (fields.length === 0) return id; // nothing to do
    const setSql = fields.map((k, i) => `${k} = $${i + 2}`).join(", ");
    const sql = `update sources set ${setSql} where id = $1 returning id;`;
    const params = [id, ...fields.map((k) => u[k])];
    const { rows } = await dbQuery<{ id: number }>(sql, params);
    return rows[0].id;
  }

  // UPSERT by id if provided
  if (typeof sourceId === "number" && sourceId > 0) {
    return runUpdate(sourceId);
  }

  // INSERT; build column list dynamically from u
  const cols = Object.keys(u);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
  const insertSql = `insert into sources (${cols.join(", ")}) values (${placeholders}) returning id;`;
  const insertParams = cols.map((k) => u[k]);

  try {
    const { rows } = await dbQuery<{ id: number }>(insertSql, insertParams);
    return rows[0].id;
  } catch (e) {
    // On unique conflict (e.g., homepage_url unique), fallback to UPDATE of the matching row.
    const err = e as { code?: string };
    if (err?.code === "23505") {
      const existing = await findExistingSourceByUrl(url);
      if (!existing) throw e;
      return runUpdate(existing.id);
    }
    throw e;
  }
}

/* ============================================================================
   LOOKUP EXISTING BY HOST
============================================================================ */

export async function findExistingSourceByUrl(inputUrl: string): Promise<ExistingSourceLite | null> {
  let host: string | null = null;
  try { host = new URL(inputUrl).host.replace(/^www\./i, ""); } catch { host = null; }
  if (!host) return null;

  const sql = `
    select id, name, homepage_url, rss_url, sitemap_url, scrape_selector, scrape_path, adapter, adapter_config
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

/* ============================================================================
   FETCH ITEMS FOR A SOURCE (honors explicit method or row fetch_mode)
============================================================================ */

export type FetchOptions = {
  /** Force a specific fetch path; when set we do NOT silently fall back. */
  method?: ProbeMethod; // "rss" | "adapter" | "scrape"
  debug?: boolean;
  jobId?: string;
  /** Optional override when an adapter/sitemap needs a direct URL. */
  urlOverride?: string;
};

type SourceRow = {
  id: number;
  homepage_url: string | null;
  rss_url: string | null;
  sitemap_url: string | null;
  scrape_selector: string | null;
  adapter: string | null;               // ← new column
  adapter_key_json: string | null;      // ← fallback from adapter_config->>'key'
  fetch_mode: ProbeMethod | "auto" | null;
};

async function loadSourceConfig(sourceId: number): Promise<SourceConfig | null> {
  const res = await dbQuery<SourceRow>(
    `
    SELECT
      id,
      homepage_url,
      rss_url,
      sitemap_url,
      scrape_selector,
      adapter,
      adapter_config->>'key' AS adapter_key_json,
      COALESCE(fetch_mode, 'auto') AS fetch_mode
    FROM sources
    WHERE id = $1::int
    `,
    [sourceId]
  );

  const row: SourceRow | undefined =
    Array.isArray(res) ? (res as unknown as { rows: SourceRow[] }).rows?.[0] : (res as { rows?: SourceRow[] }).rows?.[0];

  if (!row) return null;

  const adapterKey = row.adapter ?? row.adapter_key_json ?? null;

  const cfg: SourceConfig = {
    id: row.id,
    homepage_url: row.homepage_url,
    rss_url: row.rss_url,
    sitemap_url: row.sitemap_url,
    scrape_selector: row.scrape_selector,
    adapter: adapterKey,                                        // resolved key
    fetch_mode: (row.fetch_mode ?? "auto") as SourceConfig["fetch_mode"],
  };

  return cfg;
}

export async function fetchItemsForSource(
  sourceId: number,
  limit: number,
  opts?: FetchOptions
): Promise<FeedItem[]> {
  const cfg = await loadSourceConfig(sourceId);
  if (!cfg) return [];

  // Resolve order: explicit request > row fetch_mode > heuristic
  const requested = opts?.method; // 'rss' | 'scrape' | 'adapter' | undefined
  const explicit = (cfg.fetch_mode ?? "auto") as "auto" | ProbeMethod;

  const chosen: ProbeMethod =
    requested ??
    (explicit !== "auto" ? explicit : cfg.adapter ? "adapter" : cfg.rss_url ? "rss" : "scrape");

  /* -------------------- DISPATCH -------------------- */
  if (chosen === "adapter") {
    const adapterKey = cfg.adapter ?? null; // e.g. 'sitemap-generic', 'fantasylife', ...
    const baseUrl = (opts?.urlOverride ?? cfg.homepage_url) ?? null;

    if (!adapterKey) {
      if (requested === "adapter") {
        throw new Error(`Adapter requested but no adapter key configured for source ${sourceId}`);
      }
    } else if (!baseUrl) {
      if (requested === "adapter") {
        throw new Error(`Adapter requested but no homepage_url configured for source ${sourceId}`);
      }
    } else {
      const base = new URL(baseUrl);
      const adapter = ADAPTERS.find((a) => a.key === adapterKey);
      if (!adapter) {
        if (requested === "adapter") {
          throw new Error(`Adapter "${adapterKey}" not found for source ${sourceId}`);
        }
      } else {
        try {
          const arts = await adapter.probePreview(base);
          const items: FeedItem[] = arts
            .filter((a) => coreAllowItem({ title: a.title, link: a.url }, a.url))
            .map((a) => ({
              title: a.title,
              link: a.url,
              publishedAt: a.publishedAt ? new Date(a.publishedAt) : null,
            }));
          if (items.length) return items.slice(0, limit);
        } catch (e) {
          if (requested === "adapter") throw e;
        }
        if (requested === "adapter") return [];
      }
    }
  }

    if (chosen === "rss") {
      if (!cfg.rss_url) {
        if (requested === "rss") {
          throw new Error(`RSS requested but rss_url is missing for source ${sourceId}`);
        }
      } else {
        const items = await fetchRssItems(cfg.rss_url, limit);
        if (items.length || requested === "rss") return items; // returns [] when forced
      }
      // remove: if (requested === "rss") return [];
    }

    if (chosen === "scrape") {
      if (!cfg.homepage_url) {
        if (requested === "scrape") {
          throw new Error(`Scrape requested but homepage_url is missing for source ${sourceId}`);
        }
      } else {
        const items = await scrapeHomepage(cfg, limit);
        if (items.length || requested === "scrape") return items; // returns [] when forced
      }
      // remove: if (requested === "scrape") return [];
    }

  /* -------- AUTO FALLBACKS (only when NOT forced) -------- */

  // Try RSS first
  if (!requested && cfg.rss_url) {
    const items = await fetchRssItems(cfg.rss_url, limit);
    if (items.length) return items;
  }

  // Then scrape homepage
  if (!requested && cfg.homepage_url) {
    const items = await scrapeHomepage(cfg, limit);
    if (items.length) return items;
  }

  // If configured, use sitemap as an auto helper (not a ProbeMethod)
  if (!requested && cfg.sitemap_url) {
    const items = await fetchFromSitemap(cfg.sitemap_url, limit);
    if (items.length) return items;
  }

  // Finally, discover feeds from homepage
  if (!requested && cfg.homepage_url) {
    try {
      const candidates = await discoverFeedUrls(new URL(cfg.homepage_url));
      for (const u of candidates) {
        const items = await fetchRssItems(u, limit);
        if (items.length) return items;
      }
    } catch {
      /* ignore */
    }
  }

  return [];
}


/* ============================================================================
   PROBE BUILDERS
============================================================================ */

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
  } catch { /* ignore */ }
  return Array.from(set);
}

async function tryScrape(page: URL): Promise<ScrapeCandidate[]> {
  const homepageUrl = page.toString();
  const html = await httpGet(homepageUrl);
  const $ = cheerio.load(html);

  const isNFL = page.hostname.endsWith("nfl.com");
  const isYahoo = /(^|\.)yahoo\.com$/i.test(page.hostname);
  const isESPN  = /(^|\.)espn\.com$/i.test(page.hostname);
  
  const selectors = isYahoo
  ? ["a[href*='/nfl/']", "article a[href*='/nfl/']", "main a[href*='/nfl/']"]
  : isESPN
  ? ["a[href*='/nfl/']", "article a[href*='/nfl/']", "main a[href*='/nfl/']"]
  :isNFL
    ? ["main a[href^='/news/']", "a[href^='https://www.nfl.com/news/']", "section a[href^='/news/']", "article a[href^='/news/']"]
    : ["article a", "h2 a, h3 a", "main a"];


  
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
      if (/\/(videos|photos|tags|authors|teams)\//i.test(abs)) return;
      if (isNFL && !/\/news\//.test(abs)) return;

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

/* ============================================================================
   PREVIEW & HELPERS
============================================================================ */

async function buildPreview(
  base: URL,
  feeds: FeedCandidate[],
  scrapes: ScrapeCandidate[],
  adapters: AdapterCandidate[]
): Promise<ProbeArticle[]> {
  const host = base.host;

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
    } catch { /* ignore */ }
  }

  const bestAdapter = adapters.filter((a) => a.ok).sort((a, b) => b.itemCount - a.itemCount)[0];
  if (bestAdapter) {
    const adapter = ADAPTERS.find((a) => a.key === bestAdapter.key)!;
    const arts = await adapter.probePreview(base);
    const filtered = arts.filter((a) => allowItem({ title: a.title, link: a.url }));
    if (filtered.length) return dedupe(filtered);
  }

  const bestScrape = scrapes.filter((s) => s.ok).sort((a, b) => b.linkCount - a.linkCount)[0];
  if (bestScrape) {
    const enriched = await enrichWithOG(bestScrape.sampleUrls, host);
    const filtered = enriched.filter((a) => allowItem({ title: a.title, link: a.url }));
    if (filtered.length) return dedupe(filtered);
  }

  return [];
}

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
  try { return new URL(href, origin).toString(); } catch { return null; }
}

function dedupe<T extends { url: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(i.url) ? false : (seen.add(i.url), true))).slice(0, 50);
}

/* ============================================================================
   SCRAPE & RSS
============================================================================ */

const BAD_SCHEMES = /^(javascript:|mailto:|tel:)/i;

async function scrapeHomepage(cfg: SourceConfig, limit: number): Promise<FeedItem[]> {
  if (!cfg.homepage_url) return [];
  const base = new URL(cfg.homepage_url);
  const html = await httpGet(base.toString());
  const $ = cheerio.load(html);

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

    const hostA = (() => { try { return new URL(abs).hostname.replace(/^www\./i, ""); } catch { return ""; } })();
    const hostB = base.hostname.replace(/^www\./i, "");
    if (hostA !== hostB) return;

    const text = (($(el).text() || "") as string).trim();
    const title = text || slugTitle(abs);
    if (!title) return;

    if (!coreAllowItem({ title, link: abs }, abs)) return;

    if (!seen.has(abs)) {
      seen.add(abs);
      out.push({ title, link: abs, publishedAt: null });
    }
  });

  if (out.length === 0) {
    try {
      const enriched = await enrichWithOG([cfg.homepage_url], base.host);
      for (const a of enriched) {
        if (!a.url) continue;
        const hostA = (() => { try { return new URL(a.url).hostname.replace(/^www\./i, ""); } catch { return ""; } })();
        const hostB = base.hostname.replace(/^www\./i, "");
        if (hostA !== hostB) continue;

        const title = a.title || slugTitle(a.url);
        if (!title) continue;
        if (!coreAllowItem({ title, link: a.url }, a.url)) continue;

        out.push({
          title,
          link: a.url,
          publishedAt: a.publishedAt ? new Date(a.publishedAt) : null,
        });
        if (out.length >= limit) break;
      }
    } catch { /* ignore */ }
  }

  return out.slice(0, limit);
}

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
    const rawLink =
      get(/<link[^>]*>([\s\S]*?)<\/link>/i, block) ||
      get(/<guid[^>]*>([\s\S]*?)<\/guid>/i, block);

    const link = clean(rawLink);
    if (!/^https?:\/\//i.test(link)) continue;

    const title = clean(get(/<title[^>]*>([\s\S]*?)<\/title>/i, block));
    const pubDate = clean(get(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i, block));

    items.push({
      title,
      link,
      publishedAt: pubDate ? new Date(pubDate) : null, // <-- Date, not ISO string
    });
    if (items.length >= limit) break;
  }
  return items;
}

/* ============================================================================
   RECOMMENDER
============================================================================ */

function pickBest(
  page: URL,
  feeds: FeedCandidate[],
  scrapes: ScrapeCandidate[],
  adapters: AdapterCandidate[]
): Recommendation {
  const bestFeed = feeds.filter((f) => f.ok).sort((a, b) => b.itemCount - a.itemCount)[0];
  if (bestFeed) {
    return {
      method: "rss",
      rationale: `Valid feed (${bestFeed.itemCount} items)`,
      feedUrl: bestFeed.feedUrl,
      suggestedUrl: page.toString(),
    };
  }

  const bestAdapter = adapters.filter((a) => a.ok).sort((a, b) => b.itemCount - a.itemCount)[0];
  if (bestAdapter) {
    return {
      method: "adapter",
      rationale: `Adapter ${bestAdapter.label ?? bestAdapter.key} produced ${bestAdapter.itemCount} items`,
      suggestedUrl: page.toString(),
    };
  }

  const bestScrape = scrapes.filter((s) => s.ok).sort((a, b) => b.linkCount - a.linkCount)[0];
  if (bestScrape) {
    return {
      method: "scrape",
      rationale: `Matched ${bestScrape.linkCount} links via selector ${bestScrape.selectorTried}`,
      selector: bestScrape.selectorTried,
      suggestedUrl: page.toString(),
    };
  }

  return {
    method: "scrape",
    rationale: "No RSS/adapter match; try a custom selector.",
    suggestedUrl: page.toString(),
  };
}
