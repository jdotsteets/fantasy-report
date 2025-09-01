// lib/sourceProbe/helpers.ts
import * as cheerio from "cheerio";

// Strong, browser-like User-Agent helps with Cloudflare/CDN sites (FantasyPros, etc.)
export async function httpGet(
  url: string,
  opts?: { retries?: number; timeoutMs?: number; headers?: Record<string, string> }
): Promise<string> {
  const retries = opts?.retries ?? 2;
  const timeoutMs = opts?.timeoutMs ?? 15000;
  const headers: Record<string, string> = {
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "accept":
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    ...opts?.headers,
  };

  for (let i = 0; i <= retries; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { redirect: "follow", headers, signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      clearTimeout(t);
      if (i === retries) throw e as Error;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error("unreachable");
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
