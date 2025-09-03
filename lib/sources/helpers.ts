// lib/sources/helpers.ts
import * as cheerio from "cheerio";
import type { ProbeArticle } from "./types";
import { httpGet } from "./shared";

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

/** Find sitemap URLs via robots.txt and common paths. */
export async function discoverSitemaps(origin: string): Promise<string[]> {
  const candidates = new Set<string>([
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
    `${origin}/sitemap-index.xml`,
  ]);
  try {
    const robots = await httpGet(`${origin}/robots.txt`, { retries: 1, timeoutMs: 7000 });
    robots.split(/\r?\n/).forEach(line => {
      const m = /^sitemap:\s*(\S+)/i.exec(line);
      if (m) {
        try {
          const u = new URL(m[1], origin).toString();
          candidates.add(u);
        } catch { /* ignore */ }
      }
    });
  } catch { /* no robots is fine */ }
  return Array.from(candidates);
}