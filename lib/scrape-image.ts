// lib/scrape-image.ts

/** Normalize raw image URL against the page URL and fix protocol-relative links. */
function resolveImageUrl(raw: string | null | undefined, pageUrl: string): string | null {
  if (!raw) return null;
  let u = raw.trim();
  if (!u) return null;
  // ignore data URIs and inline svgs
  if (/^data:/i.test(u) || /\.svg(\?|#|$)/i.test(u)) return null;
  if (u.startsWith("//")) u = "https:" + u;
  try {
    return new URL(u, pageUrl).toString();
  } catch {
    return null;
  }
}

/** Pick the largest candidate from a srcset attribute (best-effort). */
function pickFromSrcset(srcset: string, pageUrl: string): string | null {
  const parts = srcset
    .split(",")
    .map((s) => s.trim())
    .map((s) => {
      const m = s.match(/^(\S+)\s+(\d+)(w|x)$/i) || s.match(/^(\S+)$/);
      if (!m) return null;
      const url = resolveImageUrl(m[1], pageUrl);
      const weight = m[2] ? parseInt(m[2], 10) : 1;
      return url ? { url, weight: Number.isFinite(weight) ? weight : 1 } : null;
    })
    .filter(Boolean) as { url: string; weight: number }[];

  if (!parts.length) return null;
  parts.sort((a, b) => b.weight - a.weight);
  return parts[0].url;
}

/** Helper to search with a regex and resolve the found URL. */
function pick(html: string, re: RegExp, pageUrl: string): string | null {
  const m = html.match(re);
  return m?.[1] ? resolveImageUrl(m[1], pageUrl) : null;
}

/** Collect all matching group 1 values for a regex. */
function pickAll(html: string, re: RegExp, pageUrl: string): string[] {
  const urls: string[] = [];
  let m: RegExpExecArray | null;
  const rx = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  while ((m = rx.exec(html))) {
    const u = resolveImageUrl(m[1], pageUrl);
    if (u) urls.push(u);
  }
  return urls;
}

/** Try a bunch of common meta/link patterns for lead images (returns multiple candidates). */
function metaCandidates(html: string, pageUrl: string): string[] {
  const out = new Set<string>();

  const metas = [
    // Open Graph (property first)
    /<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:image:url["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    // Attribute order swapped (content then property/name)
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::\w+)?["'][^>]*>/i,
    // Twitter
    /<meta[^>]+name=["']twitter:image:src["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    // schema.org (simple)
    /<meta[^>]+itemprop=["']image["'][^>]+content=["']([^"']+)["']/i,
    // legacy
    /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i,
  ];

  for (const re of metas) {
    const u = pick(html, re, pageUrl);
    if (u) out.add(u);
  }

  // Multiple OG image tags on some sites
  for (const u of pickAll(html, /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/ig, pageUrl)) {
    out.add(u);
  }

  return Array.from(out);
}

/** Parse JSON-LD blocks searching for Article/NewsArticle ImageObject/image arrays. */
function jsonLdCandidates(html: string, pageUrl: string): string[] {
  const urls: string[] = [];
  const scriptRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;

  while ((m = scriptRe.exec(html))) {
    const raw = m[1].trim();
    if (!raw) continue;
    try {
      const data = JSON.parse(raw);
      const arr = Array.isArray(data) ? data : [data];

      for (const node of arr) {
        collectJsonLd(node, pageUrl, urls);
      }
    } catch {
      // ignore malformed JSON-LD
    }
  }
  return Array.from(new Set(urls));
}

function collectJsonLd(node: any, pageUrl: string, out: string[]) {
  if (!node || typeof node !== "object") return;

  // If this node has image or thumbnailUrl
  const props = ["image", "thumbnail", "thumbnailUrl", "primaryImageOfPage"];
  for (const key of props) {
    if (node[key]) {
      const val = node[key];
      if (typeof val === "string") {
        const u = resolveImageUrl(val, pageUrl);
        if (u) out.push(u);
      } else if (Array.isArray(val)) {
        for (const v of val) {
          if (typeof v === "string") {
            const u = resolveImageUrl(v, pageUrl);
            if (u) out.push(u);
          } else if (v && typeof v === "object" && v.url) {
            const u = resolveImageUrl(v.url, pageUrl);
            if (u) out.push(u);
          }
        }
      } else if (val && typeof val === "object" && val.url) {
        const u = resolveImageUrl(val.url, pageUrl);
        if (u) out.push(u);
      }
    }
  }

  // Recurse into graph/array children
  const childrenKeys = ["@graph", "itemListElement", "hasPart", "associatedMedia"];
  for (const k of childrenKeys) {
    const child = node[k];
    if (Array.isArray(child)) {
      for (const n of child) collectJsonLd(n, pageUrl, out);
    } else if (child && typeof child === "object") {
      collectJsonLd(child, pageUrl, out);
    }
  }
}

/** Fallback: scan article/main/body for the first meaningful <img>. */
function bodyCandidates(html: string, pageUrl: string): string[] {
  const candidates: string[] = [];

  const region =
    html.match(/<article[^>]*>[\s\S]*?<\/article>/i)?.[0] ||
    html.match(/<main[^>]*>[\s\S]*?<\/main>/i)?.[0] ||
    html.match(/<body[^>]*>[\s\S]*?<\/body>/i)?.[0] ||
    html;

  // srcset first (largest)
  const srcsetRe = /<img[^>]+srcset=["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = srcsetRe.exec(region))) {
    const u = pickFromSrcset(m[1], pageUrl);
    if (u) candidates.push(u);
  }

  // lazy attrs
  const lazyRe = /<img[^>]+(?:data-src|data-original|data-lazy)=["']([^"']+)["'][^>]*>/gi;
  while ((m = lazyRe.exec(region))) {
    const u = resolveImageUrl(m[1], pageUrl);
    if (u) candidates.push(u);
  }

  // plain src
  const srcRe = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  while ((m = srcRe.exec(region))) {
    const u = resolveImageUrl(m[1], pageUrl);
    if (u) candidates.push(u);
  }

  return Array.from(new Set(candidates));
}

/** Score an image URL so we can choose the "best" candidate. Higher is better. */
function scoreUrl(u: string): number {
  let score = 0;
  const url = u.toLowerCase();

  // Prefer real formats
  if (/\.(webp)(\?|#|$)/.test(url)) score += 6;
  if (/\.(jpe?g)(\?|#|$)/.test(url)) score += 5;
  if (/\.(png)(\?|#|$)/.test(url)) score += 3;
  if (/\.(gif)(\?|#|$)/.test(url)) score -= 2; // often small/animated

  // Penalize obvious trackers/placeholders
  if (/1x1|pixel|tracker|spacer|placeholder|blank/.test(url)) score -= 8;
  if (/\/ads?\//.test(url)) score -= 5;

  // Favor larger hints in filename/query
  const sizeHints = url.match(/(\d{3,4})x(\d{3,4})/) || url.match(/w=(\d{3,4})/) || url.match(/width=(\d{3,4})/);
  if (sizeHints) score += 4;

  // Prefer https
  if (u.startsWith("https://")) score += 1;

  return score;
}

function chooseBest(cands: string[]): string | null {
  if (!cands.length) return null;
  // Deduplicate on full URL
  const uniq = Array.from(new Set(cands));
  uniq.sort((a, b) => scoreUrl(b) - scoreUrl(a));
  return uniq[0] || null;
}

/** Best-effort extraction of an article's lead image. */
export async function findArticleImage(url: string, timeoutMs = 7000): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        "accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.8",
        "cache-control": "no-cache",
        // a referer sometimes gets around anti-bot rules:
        referer: new URL(url).origin,
      },
      redirect: "follow",
    });
    if (!res.ok) return null;

    const ctype = res.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml\+xml/i.test(ctype)) return null;

    // cap body size to keep it fast (first ~600KB is plenty)
    const htmlFull = await res.text();
    const html = htmlFull.slice(0, 600_000);

    // Gather candidates from multiple strategies
    const cands: string[] = [];
    cands.push(...metaCandidates(html, url));
    cands.push(...jsonLdCandidates(html, url));
    if (cands.length === 0) {
      cands.push(...bodyCandidates(html, url));
    }

    // Choose the best-scoring candidate
    return chooseBest(cands);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
