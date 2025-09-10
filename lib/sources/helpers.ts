// lib/sources/helpers.ts
import * as cheerio from "cheerio";
import { httpGet } from "./shared";
import { classifyUrl, PageSignals, UrlClassification } from "@/lib/contentFilter";


/* ── Narrow the union members we care about ───────────────────────── */

type ArticleCls = Extract<UrlClassification, { decision: "include_article" }>;
type StaticCls  = Extract<UrlClassification, { decision: "include_static" }>;
type SectionCls = Extract<UrlClassification, { decision: "capture_section" }>;

export type ArticleCategory = ArticleCls["category"];
export type StaticType      = NonNullable<StaticCls["staticType"]>;
export type SectionType     = NonNullable<SectionCls["sectionType"]>;

/* ── Public result type for ingest routing ────────────────────────── */

export type IngestDecision =
  | { kind: "skip"; reason: string }
  | { kind: "article"; category: ArticleCategory }
  | { kind: "static";  staticType: StaticType }
  | { kind: "section"; sectionType: SectionType };

/* ── Router: classify + map to ingest actions ─────────────────────── */

export function routeByUrl(
  url: string,
  title: string | null,
  signals?: Partial<PageSignals>
): IngestDecision {
  const cls = classifyUrl(url, title, {
    hasPublishedMeta: Boolean(signals?.hasPublishedMeta),
    hasArticleSchema: Boolean(signals?.hasArticleSchema),
  });

  switch (cls.decision) {
    case "discard":
      return { kind: "skip", reason: cls.reason };
    case "include_article":
      // `cls` is narrowed to ArticleCls here; explicit cast keeps VS Code happy.
      return { kind: "article", category: cls.category as ArticleCategory };
    case "include_static":
      return { kind: "static", staticType: (cls.staticType ?? "other") as StaticType };
    case "capture_section":
    default:
      return { kind: "section", sectionType: (cls.sectionType ?? "other") as SectionType };
  }
}

export async function fetchText(url: string): Promise<string> {
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return await r.text();
}




export function parseHtml(html: string): cheerio.CheerioAPI {
  return cheerio.load(html);
}

function slugFromUrl(u: string): string {
  try {
    const { pathname } = new URL(u);
    const last = pathname.split("/").filter(Boolean).pop() ?? "";
    return decodeURIComponent(last.replace(/[-_]/g, " ")).trim() || u;
  } catch {
    return u;
  }
}

export async function enrichWithOG(urls: string[], sourceHost: string) {
  const out: {
    title: string;
    url: string;
    author: string | null;
    publishedAt: string | null;
    imageUrl: string | null;
    sourceHost: string;
  }[] = [];

  const limit = Math.min(6, Math.max(1, urls.length));
  let i = 0;

  async function worker() {
    while (i < urls.length) {
      const idx = i++;
      const u = urls[idx];
      try {
        const html = await httpGet(u, {
          headers: { referer: `https://${sourceHost}/` },
        });
        const $ = parseHtml(html);

        const title =
          $('meta[property="og:title"]').attr("content")?.trim() ||
          $('meta[name="twitter:title"]').attr("content")?.trim() ||
          $("h1").first().text().trim() ||
          $("title").first().text().trim() ||
          slugFromUrl(u);

        const author =
          $('meta[name="author"]').attr("content")?.trim() ||
          $('[rel="author"], a[href*="/author/"], a[href*="/authors/"]').first().text().trim() ||
          null;

        const time =
          $('time[datetime]').attr("datetime") ||
          $('meta[property="article:published_time"]').attr("content") ||
          $('meta[name="article:published_time"]').attr("content") ||
          null;

        const image =
          $('meta[property="og:image"]').attr("content")?.trim() ||
          $('meta[name="twitter:image"]').attr("content")?.trim() ||
          null;

        out.push({
          title,
          url: u,
          author,
          publishedAt: time ? new Date(time).toISOString() : null,
          imageUrl: image,
          sourceHost,
        });
      } catch {
        // skip this URL if fetch fails
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, worker));
  const seen = new Set<string>();
  return out.filter((a) => (seen.has(a.url) ? false : (seen.add(a.url), true)));
}


// lib/sources/helpers.ts

export async function discoverSitemaps(origin: string): Promise<string[]> {
  const candidates = new Set<string>([
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
    `${origin}/sitemap-index.xml`,
  ]);

  // Try robots.txt and collect declared Sitemap: entries
  try {
    const res = await fetch(`${origin}/robots.txt`, { redirect: "follow", cache: "no-store" });
    if (res.ok) {
      const text = await res.text();
      for (const line of text.split(/\r?\n/)) {
        const m = /^\s*Sitemap:\s*(\S+)\s*$/i.exec(line);
        if (m) {
          try {
            const u = new URL(m[1], origin).toString();
            candidates.add(u);
          } catch {
            // ignore bad URLs
          }
        }
      }
    }
  } catch {
    // robots.txt missing is fine
  }

  return Array.from(candidates);
}


// ✨ ADD these utilities (non-breaking)
export function normalizeHost(u: string | null): string | null {
  if (!u) return null;
  try {
    const host = new URL(u).host;
    return host.replace(/^www\./i, "");
  } catch {
    return null;
  }
}

export function sameHost(a: string | null, b: string | null): boolean {
  const na = normalizeHost(a);
  const nb = normalizeHost(b);
  return !!na && !!nb && na === nb;
}