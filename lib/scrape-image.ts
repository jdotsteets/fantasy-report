// lib/scrape-image.ts (or wherever you keep it)

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
    .map(s => s.trim())
    .map(s => {
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

/** Try a bunch of common meta/link patterns for lead images. */
function fromMeta(html: string, pageUrl: string): string | null {
  return (
    // Open Graph
    pick(html, /<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["']/i, pageUrl) ||
    pick(html, /<meta[^>]+property=["']og:image:url["'][^>]+content=["']([^"']+)["']/i, pageUrl) ||
    pick(html, /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i, pageUrl) ||
    // Allow attribute order swap: content before property/name
    pick(html, /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::\w+)?["'][^>]*>/i, pageUrl) ||
    // Twitter Card
    pick(html, /<meta[^>]+name=["']twitter:image:src["'][^>]+content=["']([^"']+)["']/i, pageUrl) ||
    pick(html, /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i, pageUrl) ||
    // schema.org
    pick(html, /<meta[^>]+itemprop=["']image["'][^>]+content=["']([^"']+)["']/i, pageUrl) ||
    // legacy link rel
    pick(html, /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i, pageUrl)
  );
}

/** Fallback: scan article/main/body for the first meaningful <img>. */
function fromBody(html: string, pageUrl: string): string | null {
  const region =
    html.match(/<article[^>]*>[\s\S]*?<\/article>/i)?.[0] ||
    html.match(/<main[^>]*>[\s\S]*?<\/main>/i)?.[0] ||
    html.match(/<body[^>]*>[\s\S]*?<\/body>/i)?.[0] ||
    html;

  // prefer data-src/srcset first, then src
  // 1) srcset
  const mSet = region.match(/<img[^>]+srcset=["']([^"']+)["'][^>]*>/i);
  if (mSet?.[1]) {
    const pickUrl = pickFromSrcset(mSet[1], pageUrl);
    if (pickUrl) return pickUrl;
  }

  // 2) data-src / data-original / data-lazy
  const mData = region.match(/<img[^>]+(?:data-src|data-original|data-lazy)=["']([^"']+)["'][^>]*>/i);
  if (mData?.[1]) {
    const u = resolveImageUrl(mData[1], pageUrl);
    if (u) return u;
  }

  // 3) plain src
  const mSrc = region.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i);
  if (mSrc?.[1]) {
    const u = resolveImageUrl(mSrc[1], pageUrl);
    if (u) return u;
  }

  return null;
}

/** Best-effort extraction of an article's lead image. */
export async function findArticleImage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    if (!res.ok) return null;

    const ctype = res.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml\+xml/i.test(ctype)) return null;

    // cap body size to keep it fast (first ~500KB is plenty)
    const htmlFull = await res.text();
    const html = htmlFull.slice(0, 500_000);

    // 1) Strong: meta tags
    const meta = fromMeta(html, url);
    if (meta) return meta;

    // 2) Fallback: scan visible content
    const body = fromBody(html, url);
    if (body) return body;

    return null;
  } catch {
    return null;
  }
}
