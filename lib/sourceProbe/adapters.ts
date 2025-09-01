// lib/sourceProbe/adapters.ts
import { URL } from "node:url";
import * as cheerio from "cheerio";
import type { ProbeArticle } from "./types";
import { httpGet, parseHtml, enrichWithOG, discoverSitemaps } from "./helpers";

/** Simple util */
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
  match(_base: URL) { return true; }, // decide inside probePreview
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
  match(_base: URL) { return true; },
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
  match(_base: URL) { return true; },
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
  match(_base: URL) { return true; },
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

/** Common article-path checks for fantasy.nfl.com */
function isArticlePath(path: string): boolean {
  // adjust as you learn their structure; start wide, then tighten
  return /\/news\/[^/]+/.test(path) || /\/articles?\/[^/]+/.test(path) || /\/players\/news\/[^/]+/.test(path);
}

function normalizeUrl(u: string): string {
  try { return new URL(u).toString(); } catch { return u; }
}

/* -------------------- Fantasy NFL adapter -------------------- */

async function getIndexFromDom(base: URL, pages = 2): Promise<string[]> {
  const seen = new Set<string>();
  const out: string[] = [];

  // likely listing pages; tweak as needed
  const makeUrl = (p: number) => (p === 1 ? `${base.origin}/news` : `${base.origin}/news?page=${p}`);

  for (let p = 1; p <= pages; p++) {
    try {
      const html = await httpGet(makeUrl(p));
      const $ = parseHtml(html);

      // Prefer links within <main> to avoid header/nav/footer noise
      const selectors = [
        'main article a[href^="/news/"]',
        'main h2 a[href^="/news/"]',
        'main a[href^="/news/"]',
        'main a[href*="/articles/"]',
        'main a[href*="/players/news/"]',
      ];

      for (const sel of selectors) {
        let matched = 0;
        $(sel).each((_i, el) => {
          const href = $(el).attr("href"); if (!href) return;
          const path = href.split("?")[0];
          if (!isArticlePath(path)) return;
          const abs = normalizeUrl(new URL(href, base).toString());
          if (!seen.has(abs)) { seen.add(abs); out.push(abs); matched++; }
        });
        if (matched > 0) break; // accept first selector that hits, like your FL adapter
      }
    } catch {
      /* skip page errors */
    }
  }
  return out;
}

/** NEXT.js JSON mining (e.g., __NEXT_DATA__) */
function collectFromNextData($: cheerio.CheerioAPI, base: URL): string[] {
  type JSONVal = string | number | boolean | null | JSONVal[] | { [k: string]: JSONVal };
  const links: string[] = [];
  const seen = new Set<string>();
  const scripts: string[] = [];

  $('script[id="__NEXT_DATA__"], script[type="application/json"]').each((_i, el) => {
    const txt = $(el).text();
    if (txt && txt.length > 2) scripts.push(txt);
  });

  function walk(val: JSONVal) {
    if (typeof val === "string") {
      if (val.startsWith("/") && isArticlePath(val.split("?")[0])) {
        const abs = normalizeUrl(new URL(val, base).toString());
        if (!seen.has(abs)) { seen.add(abs); links.push(abs); }
      }
      return;
    }
    if (Array.isArray(val)) { for (const v of val) walk(v); return; }
    if (val && typeof val === "object") { for (const k of Object.keys(val)) walk((val as Record<string, JSONVal>)[k]); }
  }

  for (const s of scripts) {
    try { walk(JSON.parse(s) as JSONVal); } catch { /* ignore bad JSON */ }
  }
  return links;
}

async function getIndexFromNext(base: URL): Promise<string[]> {
  try {
    const html = await httpGet(base.toString());
    const $ = parseHtml(html);
    return collectFromNextData($, base);
  } catch {
    return [];
  }
}

/** Sitemap fallback: robots discovery → read index or URL set; optional recency filter */
async function getIndexFromSitemaps(base: URL, daysBack?: number): Promise<string[]> {
  const maps = await discoverSitemaps(base.origin);
  const seen = new Set<string>();
  const out: string[] = [];
  const now = Date.now();
  const maxAge = typeof daysBack === "number" && daysBack > 0 ? daysBack * 86400000 : undefined;

  for (const sm of maps) {
    try {
      const xml = await httpGet(sm, { retries: 1, timeoutMs: 15000 });
      const $ = parseHtml(xml);
      const isIndex = $("sitemap > loc").length > 0;
      const urlsToRead = isIndex ? $("sitemap > loc").map((_i, el) => $(el).text().trim()).get() : [sm];

      for (const u of urlsToRead.slice(0, 6)) { // don’t hammer
        try {
          const xml2 = u === sm ? xml : await httpGet(u, { retries: 1, timeoutMs: 15000 });
          const $$ = parseHtml(xml2);
          $$("url").each((_j, node) => {
            const loc = $$(node).find("loc").first().text().trim();
            if (!loc) return;
            try {
              const url = new URL(loc);
              if (url.hostname !== base.hostname) return;
              if (!isArticlePath(url.pathname)) return;

              const lm = $$(node).find("lastmod").first().text().trim();
              if (lm && maxAge) {
                const d = new Date(lm);
                if (!Number.isNaN(d.valueOf()) && now - d.getTime() > maxAge) return;
              }

              const abs = normalizeUrl(url.toString());
              if (!seen.has(abs)) { seen.add(abs); out.push(abs); }
            } catch { /* ignore */ }
          });
        } catch { /* skip that sub-sitemap */ }
      }
    } catch { /* skip this map */ }
  }
  return out;
}

export type Adapter = {
  key: string;
  label: string;
  match: (base: URL) => boolean;
  probePreview: (base: URL) => Promise<ProbeArticle[]>;
  
};

export const ADAPTERS: Adapter[] = [
  // 1) Site-specific (kept first so it gets a shot before the generics)
  {
    key: "fantasy-nfl",
    label: "NFL Fantasy (site)",
    match: (base) => base.hostname.endsWith("fantasy.nfl.com"),
    async probePreview(base) {
      // Strategy 1: DOM listing pages
      const dom = await getIndexFromDom(base, 3);
      if (dom.length > 0) {
        const enriched = await enrichWithOG(dom.slice(0, 40), base.host);
        if (enriched.length > 0) return enriched;
      }

      // Strategy 2: __NEXT_DATA__ on homepage
      const nd = await getIndexFromNext(base);
      if (nd.length > 0) {
        const enriched = await enrichWithOG(nd.slice(0, 40), base.host);
        if (enriched.length > 0) return enriched;
      }

      // Strategy 3: sitemaps (robots discovery, then sub-sitemaps)
      const sm = await getIndexFromSitemaps(base, 14);
      const enriched = await enrichWithOG(sm.slice(0, 40), base.host);
      return enriched;
    },
  },

  // 2) Generic/platform adapters (broad matches)
  WORDPRESS_GENERIC,
  JSONLD_LIST,
  NEXT_DATA,
  SITEMAP_GENERIC,
];