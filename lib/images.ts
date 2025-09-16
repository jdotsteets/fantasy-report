/** Use a local static fallback image placed at /public/fallback.jpg */
export const FALLBACK = "/fallback.jpg";

/**
 * Return a valid, non-favicon HTTP(S) image URL — or null if we shouldn't render an <Image>.
 * (We do NOT auto-return FALLBACK here; choose to use FALLBACK in the caller if desired.)
 */


function safeUrl(s: string): URL | null {
  try { return new URL(s); } catch { return null; }
}


export function isPromotionalImage(url: string, alt?: string | null): boolean {
  const s = url.toLowerCase();

  // Obvious path/filename hints
  if (/\/(ads?|banners?|promos?|sponsor(ship)?|affiliates?)\//.test(s)) return true;
  if (/\b(promo|promotion|banner|advert|advertisement|sponsored|affiliate)\b/.test(s)) return true;

  // Common IAB ad sizes in filenames/paths (both 300x250 etc. and single-token like 728x90)
  if (/(^|[^0-9])(300x250|300x600|336x280|320x50|320x100|300x50|300x100|728x90|970x250|970x90|468x60|234x60|160x600|120x600|125x125|200x200|180x150)([^0-9]|$)/.test(s)) {
    return true;
  }

  // Site-specific: FFToday “creative” promos (your current offender)
  if (s.includes("fftoday.com/creative/")) return true;

  // Optional: alt text hints
  if (alt && /\b(promo|banner|advert|sponsor)\b/i.test(alt)) return true;

  return false;
}

export function isNextImageProxy(u: string): boolean {
  const url = safeUrl(u);
  if (!url) return false;
  return url.pathname.includes("/_next/image") && url.searchParams.has("url");
}

/** Extract the original URL from Next.js proxy URLs; otherwise return the input. */
export function unproxyNextImage(input: string | null): string | null {
  if (!input) return null;
  const url = safeUrl(input);
  if (!url) return null;
  if (isNextImageProxy(input)) {
    const orig = url.searchParams.get("url");
    if (!orig) return null;
    try { return new URL(orig).toString(); } catch { return null; }
  }
  return input;
}

export function getSafeImageUrl(src?: string | null): string | null {
  const s = (src ?? "").trim();
  if (!s) return null;
  const unproxied = unproxyNextImage(s) ?? "";
  if (!unproxied) return null;

  // strip obvious tracking params
  const out = new URL(unproxied);
  ["w","h","q","auto","fit","ixlib"].forEach((k) => out.searchParams.delete(k));
  return out.toString();
}

const HEADSHOT_URL_RE = /\b(avatar|headshot|mugshot|mug|byline|profile|portrait|author|bio|staff|people|face|faces)\b/i;
const HEADSHOT_HOST_RE = /\b(gravatar\.com|twimg\.com\/profile_images|graph\.facebook\.com|pbs\.twimg\.com)\b/i;
const THUMB_URL_RE = /\b(thumbs?|thumbnail|icon|favicon|sprite|logo)\b/i;

// Try to pull dimensions out of common query params or file names
function parseWHFromUrl(u: string): { w?: number; h?: number } {
  try {
    const url = new URL(u);
    const gp = url.searchParams;
    const w = Number(gp.get("w") || gp.get("width") || gp.get("cw"));
    const h = Number(gp.get("h") || gp.get("height") || gp.get("ch"));

    // Cloudinary-like .../w_640,h_640/...
    const mCloud = u.match(/(?:[\/,])w_(\d{2,4}),h_(\d{2,4})(?:[\/,]|$)/i);
    if (mCloud) return { w: Number(mCloud[1]), h: Number(mCloud[2]) };

    // filename 640x360.jpg
    const mName = u.match(/(?:^|[^\d])(\d{2,4})x(\d{2,4})(?=\D|$)/i);
    if (mName) return { w: Number(mName[1]), h: Number(mName[2]) };

    return {
      w: Number.isFinite(w) ? w : undefined,
      h: Number.isFinite(h) ? h : undefined,
    };
  } catch {
    return {};
  }
}

export function isLikelyAuthorHeadshot(url: string, alt?: string | null): boolean {
  const s = url.toLowerCase();

  // 1) Explicit host / URL regexes
  if (HEADSHOT_HOST_RE.test(s)) return true;
  if (HEADSHOT_URL_RE.test(s)) return true;

  // 2) Alt text hints
  if (alt && /\b(author|byline|headshot|mug|profile|portrait)\b/i.test(alt)) return true;

  // 3) Path patterns commonly used for author images
  if (s.includes("authoring/authoring-images")) return true;
  if (/\/(avatar|avatars|byline|authors?)\//.test(s)) return true;

  // 4) Small, avatar-like sizes in query params or path (square thumbs)
  if (/[?&](w|width)=(32|40|48|50|60|64|72|80|96)\b/i.test(s)) return true;
  if (/[?&](h|height)=(32|40|48|50|60|64|72|80|96)\b/i.test(s)) return true;
  if (/\/(32|40|48|50|60|64|72|80|96)[x×](32|40|48|50|60|64|72|80|96)\b/.test(s)) return true;

  // 5) Heuristic on parsed dimensions: tiny & square-ish or small area mugs
  const { w, h } = parseWHFromUrl(url);
  if (w && h) {
    const ar = w / h;
    const squareish = Math.abs(ar - 1) <= 0.2;
    const tinyEdge = Math.max(w, h) <= 220;  // most byline avatars <= ~200–220px
    if (squareish && tinyEdge) return true;

    // Reject small near-square editorial mugs even if slightly larger (e.g., 320x320)
    if (squareish && w * h < 140_000) return true;
  }

  return false;
}


/** Very weak article images: favicons, sprites, placeholders, proxy images, etc. */
export function isWeakArticleImage(u: string): boolean {
  const s = u.toLowerCase();

  // Block Next.js proxy images outright
  if (isNextImageProxy(s)) return true;

  // Promo/ads/banners (new)
  if (isPromotionalImage(s)) return true;

  // Obvious non-hero assets
  if (/\.(svg)(\?|#|$)/i.test(s)) return true;                 // logos/sprites
  if (/favicon|sprite|placeholder|spacer|transparent/i.test(s)) return true;

  // Tiny thumbs via query params
  if (/[?&](w|width)=(1|16|24|32|40|48|60)\b/i.test(s)) return true;
  if (/[?&](h|height)=(1|16|24|32|40|48|60)\b/i.test(s)) return true;

  // “thumbnail/thumb” only counts as weak if it’s actually small.
  if (THUMB_URL_RE.test(s)) {
    const { w, h } = parseWHFromUrl(s);
    // If we can't parse dimensions, play it safe and treat as weak.
    if (!w || !h) return true;
    // Reject small/utility variants; allow larger editorial sizes.
    if (w < 240 || h < 160) return true;
    // otherwise fall through (large “thumbnail” variants are OK)
  }


  // Author/byline avatars & headshots
  if (isLikelyAuthorHeadshot(u)) return true;

  // Parsed dimensions heuristic (too small for hero cards)
  const { w, h } = parseWHFromUrl(u);
  if (w && h) {
    if (w < 240 || h < 160) return true;
  }

  return false;
}

/** New: reject author avatars/headshots */
export function isLikelyHeadshot(url?: string | null): boolean {
  if (!url) return false;
  try {
    const { pathname } = new URL(url);
    const p = pathname.toLowerCase();
    return (
      /\/(avatar|headshot|author|byline|profile)\//i.test(p) ||
      p.endsWith("/author.jpg") ||
      p.endsWith("/profile.jpg") ||
      p.endsWith("/headshot.jpg") ||
      p.includes("authoring-images") ||
      p.includes("/byline/") ||
      p.includes("/profile/") ||
      p.includes("/profiles/") ||
      p.includes("headshot") ||
      p.includes("avatar") ||
      p.includes("/authors/") ||
      p.includes("/wp-content/uploads/avatars/")
    );
  } catch {
    return false;
  }
}

const NAME_STOPWORDS = new Set([
  "report", "reports", "breaking", "trade", "rumor", "rumors", "injury",
  "injuries", "waivers", "waiver", "week", "start", "sit", "ranks", "rankings",
  "mock", "draft", "profile", "news", "notes", "updates", "update",
  "highlights", "preview", "recap", "analysis", "projection", "projections",
  "nfl", "mlb", "nba", "nhl",
]);

function toTitleCaseToken(tok: string): string {
  if (!tok) return tok;
  return tok.replace(/^[a-z]/, (m) => m.toUpperCase());
}

function isNameToken(tok: string): boolean {
  if (!/^[a-z][a-z'-]*$/i.test(tok)) return false;
  const lower = tok.toLowerCase();
  if (NAME_STOPWORDS.has(lower)) return false;
  if (lower.length <= 2 && !/^(jr|sr|ii|iii|iv|v)$/i.test(lower)) return false;
  return true;
}

function looksLikeFullName(words: string[]): boolean {
  if (words.length < 2) return false;
  const [first, last, maybeSfx] = words;
  if (!isNameToken(first) || !isNameToken(last)) return false;
  if (maybeSfx && !/^(jr|sr|ii|iii|iv|v)$/i.test(maybeSfx)) return false;
  return true;
}

export function extractNameFromUrlPath(u: string): string | null {
  try {
    const { pathname } = new URL(u);
    const seg = pathname.split("/").filter(Boolean).pop() || "";
    const raw = seg.replace(/\.(html|htm|php)$/, "").split("?")[0];
    const toks = raw.split("-").filter(Boolean);

    for (let w = 3; w >= 2; w--) {
      for (let i = 0; i + w <= toks.length; i++) {
        const slice = toks.slice(i, i + w);
        if (looksLikeFullName(slice)) {
          const titled = slice.map(toTitleCaseToken);
          return titled.join(" ");
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function extractLikelyNameFromTitle(title: string | null | undefined): string | null {
  if (!title) return null;
  const rx = /\b([A-Z][a-z'’-]+)\s+([A-Z][a-z'’-]+)(?:\s+(Jr|Sr|II|III|IV|V))?\b/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(title))) {
    const first = m[1], last = m[2];
    const sfx = m[3] || "";
    const parts = [first, last];
    if (sfx) parts.push(sfx);
    const candidate = parts.join(" ");
    const tokens = candidate.split(/\s+/);
    if (looksLikeFullName(tokens.map(t => t.toLowerCase()))) {
      return candidate;
    }
  }
  return null;
}

export function extractPlayersFromTitleAndUrl(
  title?: string | null,
  url?: string | null
): string[] | null {
  const out = new Set<string>();
  const t = extractLikelyNameFromTitle(title ?? undefined);
  if (t) out.add(t);
  if (url && out.size === 0) {
    const u = extractNameFromUrlPath(url);
    if (u) out.add(u);
  }
  return out.size ? Array.from(out) : null;
}

export function isLikelyFavicon(url?: string | null): boolean {
  if (!url) return false;
  try {
    const { pathname } = new URL(url);
    const p = pathname.toLowerCase();
    return (
      p === "/favicon.ico" ||
      p.includes("favicon") ||
      p.includes("apple-touch-icon") ||
      p.includes("stock-image") ||
      p.includes("placeholder")
    );
  } catch {
    return false;
  }
}
