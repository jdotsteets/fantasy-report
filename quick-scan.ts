// quick-scan.ts
import * as cheerio from "cheerio";
import { setTimeout as delay } from "node:timers/promises";

type ArticleLink = { href: string; title?: string };
type Strategy = "dom" | "next-data" | "sitemap";

function normalizeUrl(u: string): string {
  const url = new URL(u);
  url.hash = "";
  for (const k of Array.from(url.searchParams.keys())) {
    if (k.toLowerCase().startsWith("utm_")) url.searchParams.delete(k);
  }
  return url.toString();
}

async function fetchText(url: string, timeoutMs = 15_000): Promise<string> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        "user-agent": "FantasyReportBot/1.0 (+https://fantasy-report.vercel.app)",
        "accept": "text/html,application/xhtml+xml,application/xml",
      },
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

function isArticlePath(path: string): boolean {
  return /^\/articles\/fantasy\/[^/]+/.test(path);
}

/* ---------- Strategy 1: DOM scan (works if SSR renders tiles) ---------- */
function collectDomLinks($: cheerio.CheerioAPI, base: string): ArticleLink[] {
  const seen = new Set<string>();
  const out: ArticleLink[] = [];

  const candidates = [
    'main h2 a[href^="/articles/fantasy/"]',
    'main h3 a[href^="/articles/fantasy/"]',
    'main a[href^="/articles/fantasy/"]',
    'a[href^="/articles/fantasy/"]',
  ];

  for (const sel of candidates) {
    $(sel).each((_i, el) => {
      const $a = $(el);
      if ($a.closest("header, nav, footer").length > 0) return;
      const href = $a.attr("href"); if (!href) return;
      const path = href.split("?")[0];
      if (!isArticlePath(path)) return;

      const abs = normalizeUrl(new URL(href, base).toString());
      if (seen.has(abs)) return;

      const title = $a.text().trim() || $a.attr("title")?.trim() || undefined;
      seen.add(abs);
      out.push({ href: abs, title });
    });
    if (out.length > 0) break; // we got a selector that works
  }
  return out;
}

/* ---------- Strategy 2: Mine __NEXT_DATA__ JSON for URLs ---------- */
function collectNextDataLinks($: cheerio.CheerioAPI, base: string): ArticleLink[] {
  const script = $('#__NEXT_DATA__[type="application/json"]').first().text();
  if (!script) return [];

  type JSONVal = string | number | boolean | null | JSONVal[] | { [k: string]: JSONVal };

  const links: ArticleLink[] = [];
  const seen = new Set<string>();

  function walk(val: JSONVal): void {
    if (typeof val === "string") {
      if (val.startsWith("/articles/fantasy/") && isArticlePath(val.split("?")[0])) {
        const abs = normalizeUrl(new URL(val, base).toString());
        if (!seen.has(abs)) {
          seen.add(abs);
          links.push({ href: abs });
        }
      }
      return;
    }
    if (Array.isArray(val)) {
      for (const v of val) walk(v);
      return;
    }
    if (val && typeof val === "object") {
      for (const k of Object.keys(val)) walk((val as Record<string, JSONVal>)[k]);
    }
  }

  try {
    const json = JSON.parse(script) as JSONVal;
    walk(json);
  } catch {
    /* ignore parse errors */
  }
  return links;
}

/* ---------- Strategy 3: sitemap fallback ---------- */
async function collectSitemapLinks(): Promise<ArticleLink[]> {
  const base = "https://www.fantasylife.com";
  const sitemapUrl = `${base}/sitemap.xml`;
  const xml = await fetchText(sitemapUrl);
  const $ = cheerio.load(xml, { xmlMode: true });

  // sitemap index → sub-sitemaps
  const submaps: string[] = [];
  $("sitemap > loc").each((_i, el) => {
    const loc = $(el).text().trim();
    if (loc) submaps.push(loc);
  });

  const all: ArticleLink[] = [];
  const seen = new Set<string>();

  async function readMap(url: string): Promise<void> {
    try {
      const content = await fetchText(url);
      const $$ = cheerio.load(content, { xmlMode: true });
      $$("url > loc").each((_i, el) => {
        const loc = $$(el).text().trim();
        if (!loc) return;
        try {
          const u = new URL(loc);
          if (u.hostname !== "www.fantasylife.com") return;
          if (!isArticlePath(u.pathname)) return;
          const abs = normalizeUrl(u.toString());
          if (seen.has(abs)) return;
          seen.add(abs);
          all.push({ href: abs });
        } catch {
          /* skip */
        }
      });
    } catch {
      /* skip broken maps */
    }
  }

  if (submaps.length === 0) {
    // single sitemap
    await readMap(sitemapUrl);
  } else {
    // read a few sub-sitemaps (avoid hammering)
    const limited = submaps.slice(0, 5); // tune as needed
    for (const sm of limited) await readMap(sm);
  }
  return all;
}

/* ---------- Page helper that tries DOM → NEXT_DATA → sitemap ---------- */
async function getLinksFromPage(page = 1): Promise<{ strategy: Strategy; links: ArticleLink[] }> {
  const base = "https://www.fantasylife.com";
  const url = page === 1 ? `${base}/articles/fantasy` : `${base}/articles/fantasy?page=${page}`;
  const html = await fetchText(url);
  const $ = cheerio.load(html);

  // 1) DOM selectors (best if SSR)
  const dom = collectDomLinks($, base);
  if (dom.length > 0) return { strategy: "dom", links: dom };

  // 2) __NEXT_DATA__ mining
  const nd = collectNextDataLinks($, base);
  if (nd.length > 0) return { strategy: "next-data", links: nd };

  // 3) sitemap fallback (page param ignored here; useful for a quick sanity list)
  const sm = await collectSitemapLinks();
  return { strategy: "sitemap", links: sm };
}

/* ---------- Runner ---------- */
(async () => {
  for (let p = 1; p <= 3; p++) {
    const { strategy, links } = await getLinksFromPage(p);
    console.log(`Page ${p} [${strategy}]: ${links.length} links`);
    console.log(links.slice(0, 20));
    await delay(400);
  }
})();
