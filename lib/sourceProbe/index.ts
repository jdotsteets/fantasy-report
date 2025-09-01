// lib/sourceProbe/index.ts
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
import { ADAPTERS } from "./adapters";
import { httpGet, enrichWithOG } from "./helpers";
import { allowItem as _allowItem } from "@/lib/contentFilter";

const allowItem = _allowItem as (x: { title: string; link: string }) => boolean;
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



/* ---------------- Scrape (host-aware with JSON-LD assist) ---------------- */
/* ---------------- Scrape (host-aware + pagination + JSON-LD assist) ---------------- */

async function tryScrape(page: URL): Promise<ScrapeCandidate[]> {
  const host = page.hostname;
  const isNFL  = host.endsWith("nfl.com");
  const isRoto = host.endsWith("rotowire.com");
  const isFP   = host.endsWith("fantasypros.com");

  // Host-specific article path checks
  const isRotoArticlePath = (path: string): boolean => {
    if (/^\/football\/article\/[A-Za-z0-9-]+/.test(path)) return true;
    if (/^\/football\/article\.php\b/.test(path)) return true;
    return false;
  };

  const isFPArticlePath = (path: string): boolean => {
    // WordPress-style: /YYYY/MM/slug/  (common)
    if (/^\/\d{4}\/\d{2}\/[A-Za-z0-9-]+\/?$/.test(path)) return true;
    // Sometimes /YYYY/slug/
    if (/^\/\d{4}\/[A-Za-z0-9-]+\/?$/.test(path)) return true;
    // Rarely /nfl/news/slug/
    if (/^\/nfl\/news\/[A-Za-z0-9-]+\/?$/.test(path)) return true;
    return false;
  };

  // Pages to fetch (FantasyPros: also fetch /page/2/ for better recall)
  const pagesToFetch: string[] = [page.toString()];
  if (isFP) {
    try {
      // Normalize to .../ (so ./page/2/ resolves correctly)
      const baseStr = page.pathname.endsWith("/") ? page.toString() : new URL(page.pathname + "/", page).toString();
      pagesToFetch.push(new URL("./page/2/", baseStr).toString());
    } catch { /* ignore */ }
  }

  // Pull HTML from 1–2 pages
  const htmls: { url: string; $: cheerio.CheerioAPI }[] = [];
  for (const u of pagesToFetch) {
    try {
      const html = await httpGet(u);
      htmls.push({ url: u, $: cheerio.load(html) });
    } catch {
      // ignore a failing page (e.g., no /page/2/)
    }
  }
  if (htmls.length === 0) {
    // final fallback – just attempt current page
    const html = await httpGet(page.toString());
    htmls.push({ url: page.toString(), $: cheerio.load(html) });
  }

  // Host-aware selector sets
  const selectors = isNFL
    ? [
        "main a[href^='/news/']",
        "a[href^='https://www.nfl.com/news/']",
        "section a[href^='/news/']",
        "article a[href^='/news/']",
      ]
    : isRoto
    ? [
        "main a[href^='/football/article/']",
        "a[href^='https://www.rotowire.com/football/article/']",
        "main a[href*='/football/article/']",
      ]
    : isFP
    ? [
        // These are intentionally broad; the per-link path filter gates to real articles.
        "main article a",
        "main h2 a, main h3 a",
        "article h2 a, article h3 a",
      ]
    : [
        // generic fallbacks
        "article a",
        "h2 a, h3 a",
        "main a",
      ];

  // Collect links from each selector across all fetched pages
  const out: ScrapeCandidate[] = [];
  for (const sel of selectors) {
    const urls: string[] = [];
    const titles: string[] = [];
    const seen = new Set<string>();

    for (const { $, url } of htmls) {
      const baseForThisPage = new URL(url);
      $(sel).each((_i, el) => {
        const hrefRaw = ($(el).attr("href") ?? "").trim();
        if (!hrefRaw) return;
        let abs: string;
        try {
          abs = new URL(hrefRaw, baseForThisPage).toString();
        } catch {
          return;
        }
        if (!abs.startsWith(page.origin)) return;

        const u = new URL(abs);
        // Host-aware article gating
        if (isNFL && !/\/news\//.test(u.pathname)) return;
        if (isRoto && !isRotoArticlePath(u.pathname)) return;
        if (isFP && !isFPArticlePath(u.pathname)) return;

        const key = u.toString();
        if (seen.has(key)) return;
        seen.add(key);
        urls.push(key);

        const t = ($(el).text() || slugTitle(key)).trim();
        titles.push(t);
      });
    }

    out.push({
      homepageUrl: page.toString(),
      selectorTried: sel + (pagesToFetch.length > 1 ? " (+page2)" : ""),
      ok: urls.length > 0,
      linkCount: urls.length,
      sampleUrls: urls.slice(0, 24),
      sampleTitles: titles.slice(0, 24),
      error: null,
    });
  }

  // JSON-LD assist (across fetched pages)
  const ldUrlsSeen = new Set<string>();
  for (const { $, url } of htmls) {
    const baseForThisPage = new URL(url);
    $('script[type="application/ld+json"]').each((_i, el) => {
      const txt = $(el).text();
      if (!txt) return;
      try {
        type J = string | number | boolean | null | J[] | { [k: string]: J };
        const looksLikeUrl = (s: string) => s.startsWith("http") || s.startsWith("/");
        const pushIf = (s: string) => {
          try {
            const abs = new URL(s, baseForThisPage).toString();
            if (!abs.startsWith(page.origin)) return;
            const u = new URL(abs);
            if (isNFL && !/\/news\//.test(u.pathname)) return;
            if (isRoto && !isRotoArticlePath(u.pathname)) return;
            if (isFP && !isFPArticlePath(u.pathname)) return;
            ldUrlsSeen.add(abs);
          } catch { /* ignore */ }
        };
        const walk = (v: J): void => {
          if (typeof v === "string") { if (looksLikeUrl(v)) pushIf(v); return; }
          if (Array.isArray(v)) { for (const x of v) walk(x); return; }
          if (v && typeof v === "object") { for (const k of Object.keys(v)) walk((v as { [k: string]: J })[k]); }
        };
        walk(JSON.parse(txt) as J);
      } catch { /* ignore bad JSON */ }
    });
  }
  const ldList = Array.from(ldUrlsSeen);
  out.push({
    homepageUrl: page.toString(),
    selectorTried: "jsonld" + (pagesToFetch.length > 1 ? " (+page2)" : ""),
    ok: ldList.length > 0,
    linkCount: ldList.length,
    sampleUrls: ldList.slice(0, 24),
    sampleTitles: ldList.slice(0, 24).map((u) => slugTitle(u)),
    error: null,
  });

  return out;
}
;


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
    // Try OG enrichment first (better quality)
    const enriched = await enrichWithOG(bestScrape.sampleUrls, host);
    const filtered = enriched.filter((a) => allowItem({ title: a.title, link: a.url }));
    if (filtered.length) return dedupe(filtered);

    // Fallback: if enrichment was blocked by the site, use the scraped titles directly
    if (bestScrape.sampleUrls.length) {
      const crude = bestScrape.sampleUrls.map((url, i) => ({
        title: (bestScrape.sampleTitles[i] || slugTitle(url)),
        url,
        author: null,
        publishedAt: null,
        imageUrl: null,
        sourceHost: host,
      }));
      const crudeFiltered = crude.filter((a) => allowItem({ title: a.title, link: a.url }));
      if (crudeFiltered.length) return dedupe(crudeFiltered);
      // If even the filter hides everything, show at least a small unfiltered preview
      if (crude.length) return dedupe(crude);
    }
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
