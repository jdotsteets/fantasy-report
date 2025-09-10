// lib/sources/adapters.ts
import * as cheerio from "cheerio";
import { URL } from "node:url";
import type { ProbeArticle } from "./types";
import { fetchText, enrichWithOG, parseHtml, discoverSitemaps } from "./helpers";
import { httpGet } from "./shared";
import { FeedItem } from "./types";
// --- FFToday adapter lives here (both probe + ingest) ---


type AdapterConfig = {
  limit?: number;
  headers?: Record<string, string>;
};

const FFT_ORIGIN = "https://www.fftoday.com";

// Add/remove authors as needed
const FFT_AUTHORS = ["schwarz", "orth", "mack", "hecox", "eakin", "hutchins"];

const fftHeaders = (cfg?: AdapterConfig) => ({
  "user-agent":
    "Mozilla/5.0 (compatible; FantasyAggregator/1.0; +https://example.com)",
  accept: "text/html,application/xhtml+xml",
  ...(cfg?.headers ?? {}),
});

async function fftFetchHtml(pathOrAbs: string, cfg?: AdapterConfig): Promise<string> {
  const url = pathOrAbs.startsWith("http")
    ? pathOrAbs
    : new URL(pathOrAbs, FFT_ORIGIN).toString();
  const res = await fetch(url, { headers: fftHeaders(cfg) });
  if (!res.ok) throw new Error(`fetch ${url} ${res.status}`);
  return await res.text();
}

function absFFT(href: string) {
  try {
    return new URL(href, FFT_ORIGIN).toString();
  } catch {
    return href;
  }
}

/** Collect recent article URLs across several author pages. */
async function fftCollectIndex(limit = 40, cfg?: AdapterConfig): Promise<string[]> {
  const urls: string[] = [];
  const seen = new Set<string>();

  for (const author of FFT_AUTHORS) {
    // some authors use .html, others .htm
    const html =
      (await fftFetchHtml(`/articles/${author}/index.html`, cfg).catch(() =>
        fftFetchHtml(`/articles/${author}/index.htm`, cfg)
      )) || "";
    const $ = cheerio.load(html);

    $(
      `a[href^="/articles/"][href$=".htm"], a[href^="/articles/"][href$=".html"]`
    ).each((_i, el) => {
      const href = ($(el).attr("href") ?? "").trim();
      if (!href || /\/index\.htm(l)?$/i.test(href)) return;
      const abs = absFFT(href);
      if (!seen.has(abs)) {
        seen.add(abs);
        urls.push(abs);
      }
    });

    if (urls.length >= limit) break;
  }

  return urls.slice(0, limit);
}

/** Ingestion-friendly adapter (structurally matches your SourceAdapter). */
export const FFTODAY_INGEST_ADAPTER = {
  key: "fftoday",

  async getIndex(_pages = 1, cfg?: AdapterConfig) {
    void _pages;
    const limit = cfg?.limit ?? 40;
    const urls = await fftCollectIndex(limit, cfg);
    return urls.map((url) => ({ url }));
  },

  async getArticle(url: string, cfg?: AdapterConfig) {
    const html = await fftFetchHtml(url, cfg);
    const $ = cheerio.load(html);

    const title =
      $(`meta[property="og:title"]`).attr("content")?.trim() ||
      $("title").text().trim() ||
      url;

    const description =
      $(`meta[name="description"]`).attr("content")?.trim() ||
      $(`meta[property="og:description"]`).attr("content")?.trim();

    const imageUrl =
      $(`meta[property="og:image"]`).attr("content") || undefined;

    const author =
      $(`meta[name="author"]`).attr("content") ||
      $(`a[href*="/authors/"]`).first().text().trim() ||
      undefined;

    // Best-effort date (site is inconsistent, so keep it lenient)
    let publishedAt: string | undefined;
    const dt =
      $('time[datetime]').attr('datetime') ||
      $('time').first().text().trim();
    if (dt) {
      const d = new Date(dt);
      if (!Number.isNaN(d.getTime())) publishedAt = d.toISOString();
    }

    return { url, title, description, imageUrl, author, publishedAt };
  },
} as const;

/** Probe adapter (for the Probe panel UI). */
export const FFTODAY_SITE = {
  key: "fftoday",
  label: "FFToday (authors)",
  match: (base: URL) => base.hostname.endsWith("fftoday.com"),
async probePreview(base: URL) {
  const hits = await FFTODAY_INGEST_ADAPTER.getIndex(1, { limit: 24 });

  const arts = await Promise.all(
    hits.slice(0, 24).map(async (h): Promise<ProbeArticle | null> => {
      try {
        const a = await FFTODAY_INGEST_ADAPTER.getArticle(h.url, {});
        return {
          title: a.title,
          url: a.url,
          imageUrl: a.imageUrl ?? null,
          author: a.author ?? null,
          publishedAt: a.publishedAt ?? null,
          sourceHost: base.host,
        } satisfies ProbeArticle;
      } catch {
        return null;
      }
    })
  );

  return arts.filter((x): x is ProbeArticle => x !== null);
},
} as const;


export type Adapter = {
  key: string;
  label: string;
  match: (base: URL) => boolean;
  probePreview: (base: URL) => Promise<ProbeArticle[]>; // returns normalized preview articles
};

function slugTitle(u: string): string {
  try {
    const { pathname } = new URL(u);
    const last = pathname.split("/").filter(Boolean).pop() ?? "";
    return decodeURIComponent(last.replace(/[-_]/g, " ")).trim();
  } catch {
    return u;
  }
}

/** Example domain adapter: fantasy.nfl.com */
const fantasyNflAdapter: Adapter = {
  key: "fantasy-nfl",
  label: "NFL Fantasy (site)",
  match: (base) => base.host.endsWith("fantasy.nfl.com"),
  probePreview: async (base) => {
    const hosts = [base.toString(), new URL("/news", base).toString()];
    const urls = new Set<string>();

    for (const page of hosts) {
      try {
        const html = await fetchText(page);
        const $ = cheerio.load(html);
        // Collect likely article links; adjust/selectors as needed.
        $("a[href*='/news/'], a[href*='/articles/'], article a").each((_i, el) => {
          const href = ($(el).attr("href") ?? "").trim();
          if (!href) return;
          const abs = new URL(href, base).toString();
          if (abs.startsWith(base.origin)) urls.add(abs);
        });
      } catch {
        // ignore individual page failures
      }
    }

    const enriched = await enrichWithOG(Array.from(urls).slice(0, 30), base.host);
    // Fallback to sluggy titles if OG failed everywhere
    return enriched.length
      ? enriched
      : Array.from(urls)
          .slice(0, 30)
          .map((u) => ({ title: slugTitle(u), url: u, author: null, publishedAt: null, imageUrl: null, sourceHost: base.host }));
  },
};

function withinHost(url: string, base: URL): boolean {
  try { return new URL(url, base).host === base.host; } catch { return false; }
}

/* ──────────────────────────────────────────────────────────────
   1) WordPress (generic)
   Detects WP via generator/meta/paths and scrapes article permalinks.
   Works for many sites (incl. FantasyPros).
   ────────────────────────────────────────────────────────────── */
export const WORDPRESS_GENERIC = {
  key: "wordpress-generic",
  label: "WordPress (generic)",
  match(_base: URL) {void _base; return true; }, // decide inside probePreview
  
  async probePreview(base: URL): Promise<ProbeArticle[]> {
    const html = await httpGet(base.toString());
    const $ = parseHtml(html);

    const isWP =
      $('meta[name="generator"][content*="WordPress"]').length > 0 ||
      html.includes("/wp-content/") ||
      html.includes("/wp-json") ||
      $('link[rel="shortlink"]').length > 0;

    if (!isWP) return [];

    // Common WP selectors; we gate by permalink shapes below
    const sels = [
      ".entry-title a",
      "article h2 a, article h3 a",
      "h2 a[rel='bookmark']",
      "a[rel='bookmark']",
    ];

    const seen = new Set<string>();
    const urls: string[] = [];

    for (const sel of sels) {
      $(sel).each((_i, el) => {
        const href = ($(el).attr("href") ?? "").trim();
        if (!href) return;
        const abs = new URL(href, base).toString();
        if (!withinHost(abs, base)) return;

        const p = new URL(abs).pathname;
        // Typical WP permalinks: /YYYY/MM/slug/, /YYYY/slug/
        const looksLikePost =
          /^\/\d{4}\/\d{2}\/[A-Za-z0-9-]+\/?$/.test(p) ||
          /^\/\d{4}\/[A-Za-z0-9-]+\/?$/.test(p);
        if (!looksLikePost) return;

        if (!seen.has(abs)) { seen.add(abs); urls.push(abs); }
      });
    }

    if (urls.length === 0) return [];
    return enrichWithOG(urls.slice(0, 40), base.host);
  },
};

/* ──────────────────────────────────────────────────────────────
   2) JSON-LD (ItemList/NewsArticle)
   Mines <script type="application/ld+json"> for article URLs.
   Great for modern sites with structured data.
   ────────────────────────────────────────────────────────────── */
export const JSONLD_LIST = {
  key: "jsonld-list",
  label: "JSON-LD (ItemList/NewsArticle)",
  match(_base: URL) {void _base; return true; },
  async probePreview(base: URL): Promise<ProbeArticle[]> {
    const html = await httpGet(base.toString());
    const $ = parseHtml(html);

    type J = string | number | boolean | null | J[] | { [k: string]: J };
    const out: string[] = [];
    const seen = new Set<string>();
    const looksLikeUrl = (s: string) => s.startsWith("http") || s.startsWith("/");

    const pushIf = (s: string) => {
      try {
        const abs = new URL(s, base).toString();
        if (withinHost(abs, base) && !seen.has(abs)) { seen.add(abs); out.push(abs); }
      } catch { /* ignore */ }
    };

    const walk = (v: J): void => {
      if (typeof v === "string") { if (looksLikeUrl(v)) pushIf(v); return; }
      if (Array.isArray(v)) { for (const x of v) walk(x); return; }
      if (v && typeof v === "object") { for (const k of Object.keys(v)) walk((v as { [k: string]: J })[k]); }
    };

    $('script[type="application/ld+json"]').each((_i, el) => {
      const txt = $(el).text();
      if (!txt) return;
      try { walk(JSON.parse(txt) as J); } catch { /* ignore */ }
    });

    if (out.length === 0) return [];
    return enrichWithOG(out.slice(0, 40), base.host);
  },
};

/* ──────────────────────────────────────────────────────────────
   3) Next.js (__NEXT_DATA__)
   Walks the JSON blob for same-host article URLs.
   ────────────────────────────────────────────────────────────── */
export const NEXT_DATA = {
  key: "next-data",
  label: "Next.js data",
  match(_base: URL) {void _base; return true; },
  async probePreview(base: URL): Promise<ProbeArticle[]> {
    const html = await httpGet(base.toString());
    const $ = parseHtml(html);

    const script = $('#__NEXT_DATA__, script#__NEXT_DATA__').first().text().trim();
    if (!script) return [];

    type J = string | number | boolean | null | J[] | { [k: string]: J };
    const out: string[] = [];
    const seen = new Set<string>();

    const pushIf = (s: string) => {
      try {
        const abs = new URL(s, base).toString();
        if (!withinHost(abs, base)) return;
        if (!seen.has(abs)) { seen.add(abs); out.push(abs); }
      } catch { /* ignore */ }
    };

    const walk = (v: J): void => {
      if (typeof v === "string") { if (v.startsWith("/")) pushIf(v); return; }
      if (Array.isArray(v)) { for (const x of v) walk(x); return; }
      if (v && typeof v === "object") { for (const k of Object.keys(v)) walk((v as { [k: string]: J })[k]); }
    };

    try { walk(JSON.parse(script) as J); } catch { return []; }
    if (out.length === 0) return [];
    return enrichWithOG(out.slice(0, 40), base.host);
  },
};

/* ──────────────────────────────────────────────────────────────
   4) Sitemap (generic)
   Reads robots.txt → sitemaps, takes recent same-host URLs.
   ────────────────────────────────────────────────────────────── */
export const SITEMAP_GENERIC = {
  key: "sitemap-generic",
  label: "Sitemap (generic)",
  match(_base: URL) {void _base; return true; },
  async probePreview(base: URL): Promise<ProbeArticle[]> {
    const maps = await discoverSitemaps(base.origin);
    const seen = new Set<string>();
    const urls: string[] = [];

    for (const sm of maps) {
      try {
        const xml = await httpGet(sm, { retries: 1 });
        const $ = cheerio.load(xml, { xmlMode: true });

        // If this is an index, expand a few children; else treat as URL set.
        const urlsets = $("sitemap > loc").map((_i, el) => $(el).text().trim()).get();
        const toRead = urlsets.length ? urlsets.slice(0, 6) : [sm];

        for (const u of toRead) {
          const xml2 = u === sm ? xml : await httpGet(u, { retries: 1 });
          const $$ = cheerio.load(xml2, { xmlMode: true });
          $$("url").each((_j, node) => {
            const loc = $$(node).find("loc").first().text().trim();
            if (!loc || !withinHost(loc, base)) return;
            if (!seen.has(loc)) { seen.add(loc); urls.push(loc); }
          });
        }
      } catch { /* ignore this sitemap */ }
    }

    if (urls.length === 0) return [];
    return enrichWithOG(urls.slice(0, 40), base.host);
  },
};

function titleFromUrl(u: string): string {
  try {
    const url = new URL(u);
    const slug = url.pathname.split("/").filter(Boolean).pop() ?? "";
    return decodeURIComponent(slug.replace(/[-_]+/g, " ")).trim() || u;
  } catch {
    return u;
  }
}

function candidateSitemaps(homepage: string): string[] {
  try {
    const h = new URL(homepage);
    const base = `${h.protocol}//${h.host}`;
    return [
      `${base}/sitemap.xml`,
      `${base}/sitemap_index.xml`,
      `${base}/sitemap-index.xml`,
      `${base}/sitemap-index.xml.gz`,
      `${base}/sitemap.xml.gz`,
    ];
  } catch {
    return [homepage];
  }
}

function parseLocs(xml: string): string[] {
  const locs: string[] = [];
  const re = /<loc>\s*([^<\s][^<]*)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    locs.push(m[1]);
  }
  return Array.from(new Set(locs));
}

export async function fetchFromSitemap(
  homepage: string,
  limit: number
): Promise<FeedItem[]> {
  const urls: string[] = [];
  const cands = candidateSitemaps(homepage);

  for (const sm of cands) {
    try {
      const res = await fetch(sm, { cache: "no-store" });
      if (!res.ok) continue;
      const xml = await res.text();
      const locs = parseLocs(xml);
      urls.push(...locs);
      if (urls.length >= limit * 3) break; // plenty to filter
    } catch {
      // ignore and try next
    }
  }

  // keep same host as homepage
  let host = "";
  try { host = new URL(homepage).host; } catch { /* noop */ }

  const filtered = urls
    .filter((u) => {
      try { return new URL(u).host === host; } catch { return false; }
    })
    .slice(0, limit);

  return filtered.map<FeedItem>((u) => ({
    title: titleFromUrl(u),
    link: u,
    author: null,
    description: null,
    imageUrl: null,
    publishedAt: null,
  }));
}

export const ADAPTERS: Adapter[] = [
  fantasyNflAdapter,
  WORDPRESS_GENERIC,
  JSONLD_LIST,
  NEXT_DATA,
  SITEMAP_GENERIC,
  FFTODAY_SITE,
  
  // add more adapters here…
];
