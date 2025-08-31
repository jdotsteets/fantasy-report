import { httpGet, parseHtml, normalizeUrl } from "./shared";
import type { ScrapedItem } from "./types";

type IndexHit = { url: string; title?: string; author?: string; lastmod?: string };

type IndexConfig = {
  headers?: Record<string, string>;
  /** Max number of links to return (after dedupe). */
  limit?: number;
  /** If set, only return items whose lastmod is within N days. (Sitemap path only.) */
  daysBack?: number;
};

/* ---------------- helpers ---------------- */

function isArticlePath(path: string): boolean {
  return /^\/articles\/fantasy\/[^/]+/.test(path);
}

function pushUnique<T>(arr: T[], seen: Set<string>, key: string, item: T) {
  if (seen.has(key)) return;
  seen.add(key);
  arr.push(item);
}

/* ---------------- DOM index (best case) ---------------- */

async function getIndexFromDom(pageCount = 2): Promise<IndexHit[]> {
  const base = "https://www.fantasylife.com";
  const seen = new Set<string>();
  const out: IndexHit[] = [];

  for (let p = 1; p <= pageCount; p++) {
    const url = p === 1 ? `${base}/articles/fantasy` : `${base}/articles/fantasy?page=${p}`;
    try {
      const html = await httpGet(url, { retries: 2, timeoutMs: 15000 });
      const $ = parseHtml(html);

      // Prefer links inside <main>; skip header/nav/footer noise
      const selectors = [
        'main h2 a[href^="/articles/fantasy/"]',
        'main h3 a[href^="/articles/fantasy/"]',
        'main a[href^="/articles/fantasy/"]',
      ];

      let matched = 0;
      for (const sel of selectors) {
        $(sel).each((_i, el) => {
          const $a = $(el);
          if ($a.closest("header, nav, footer").length > 0) return;
          const href = $a.attr("href"); if (!href) return;
          const path = href.split("?")[0]; if (!isArticlePath(path)) return;

          const abs = normalizeUrl(new URL(href, base).toString());
          const title = $a.text().trim() || $a.attr("title")?.trim() || undefined;
          pushUnique(out, seen, abs, { url: abs, title });
          matched++;
        });
        if (matched > 0) break;
      }
    } catch {
      // ignore page errors; try the next
    }
  }

  return out;
}

/* ---------------- sitemap fallback (robust) ---------------- */

async function getIndexFromSitemap(limit?: number, daysBack?: number): Promise<IndexHit[]> {
  const base = "https://www.fantasylife.com";
  const xml = await httpGet(`${base}/sitemap.xml`, { retries: 2, timeoutMs: 15000 });
  const $ = parseHtml(xml); // cheerio auto-detects XML fine without xmlMode flag

  const submaps: string[] = [];
  $("sitemap > loc").each((_i, el) => {
    const loc = $(el).text().trim();
    if (loc) submaps.push(loc);
  });

  // If there’s no sitemap index, read the root sitemap as a URL set
  const mapsToRead = submaps.length > 0 ? submaps : [`${base}/sitemap.xml`];

  const out: IndexHit[] = [];
  const seen = new Set<string>();
  const now = Date.now();
  const maxAgeMs = typeof daysBack === "number" && daysBack > 0 ? daysBack * 86400000 : undefined;

  for (const sm of mapsToRead) {
    try {
      const content = sm === `${base}/sitemap.xml` ? xml : await httpGet(sm, { retries: 1, timeoutMs: 15000 });
      const $$ = parseHtml(content);

      $$("url").each((_j, node) => {
        const loc = $$(node).find("loc").first().text().trim();
        if (!loc) return;
        try {
          const u = new URL(loc);
          if (u.hostname !== "www.fantasylife.com") return;
          if (!isArticlePath(u.pathname)) return;

          let lastmod: string | undefined;
          const lm = $$(node).find("lastmod").first().text().trim();
          if (lm) {
            const d = new Date(lm);
            if (!Number.isNaN(d.valueOf())) lastmod = d.toISOString();
            // recency filter (optional)
            if (maxAgeMs && lastmod) {
              const age = now - new Date(lastmod).getTime();
              if (age > maxAgeMs) return;
            }
          }

          const abs = normalizeUrl(u.toString());
          pushUnique(out, seen, abs, { url: abs, lastmod });
        } catch {
          /* skip bad URL */
        }
      });

      if (typeof limit === "number" && limit > 0 && out.length >= limit) break;
    } catch {
      /* skip broken sub-sitemap */
    }
  }

  // If limiting, trim to the first N (they’re roughly grouped by time in many sitemaps)
  if (typeof limit === "number" && limit > 0 && out.length > limit) {
    return out.slice(0, limit);
  }
  return out;
}

/* ---------------- public adapter API ---------------- */

export async function getIndex(
  pageCount: number = 2,
  config?: IndexConfig
): Promise<IndexHit[]> {
  // Try DOM (fast path) first
  const dom = await getIndexFromDom(pageCount);
  if (dom.length > 0) {
    return typeof config?.limit === "number" && config.limit > 0
      ? dom.slice(0, config.limit)
      : dom;
  }

  // Fall back to sitemap (robust, covers entire history)
  return await getIndexFromSitemap(config?.limit, config?.daysBack);
}

export async function getArticle(
  url: string,
  _config?: { headers?: Record<string, string> }
): Promise<ScrapedItem> {
  const html = await httpGet(url, { retries: 2, timeoutMs: 15000 });
  const $ = parseHtml(html);

  const og = (prop: string): string | undefined =>
    $(`meta[property="og:${prop}"]`).attr("content")?.trim();

  const title =
    og("title") || $("h1").first().text().trim() || "Untitled";

  const description =
    og("description") ||
    $('meta[name="description"]').attr("content")?.trim() ||
    undefined;

  const imageUrl =
    og("image") ||
    $('meta[name="twitter:image"]').attr("content")?.trim() ||
    undefined;

  let author: string | undefined =
    $('[rel="author"], a[href*="/author/"], a[href*="/authors/"]')
      .first()
      .text()
      .trim() ||
    $('[class*="byline"], [class*="author"]')
      .first()
      .text()
      .trim() ||
    undefined;

  if (author) author = author.replace(/^by\s+/i, "").trim();

  let publishedAt: string | undefined;
  const timeAttr =
    $('time[datetime]').attr("datetime") ||
    $('meta[property="article:published_time"]').attr("content") ||
    $('meta[name="article:published_time"]').attr("content") ||
    undefined;

  if (timeAttr) {
    const d = new Date(timeAttr);
    if (!Number.isNaN(d.valueOf())) publishedAt = d.toISOString();
  }

  return {
    url: normalizeUrl(url),
    title,
    description,
    imageUrl,
    author,
    publishedAt,
  };
}

// Back-compat re-exports for older code that expects these names
export { getIndex as scrapeIndex, getArticle as enrichArticle };
