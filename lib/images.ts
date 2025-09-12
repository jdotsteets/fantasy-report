/** Use a local static fallback image placed at /public/fallback.jpg */
export const FALLBACK = "/fallback.jpg";

/**
 * Return a valid, non-favicon HTTP(S) image URL — or null if we shouldn't render an <Image>.
 * (We do NOT auto-return FALLBACK here; choose to use FALLBACK in the caller if desired.)
 */
export function getSafeImageUrl(input?: string | null): string | null {
  if (!input) return null;

  let url = input.trim();

  // Fix protocol-relative URLs
  if (url.startsWith("//")) url = "https:" + url;

  // Must be http(s)
  if (!/^https?:\/\//i.test(url)) return null;

  try {
    // Validate URL structure
    const u = new URL(url);

    // Filter obvious low-value images
    const p = u.pathname.toLowerCase();
    if (isLikelyFavicon(url)) return null;
    if (isLikelyHeadshot(url)) return null;
    if (
      p.includes("sprite") ||
      p.includes("logo") ||
      p.includes("placeholder") ||
      p.includes("stock")
    ) {
      return null;
    }

    return url;
  } catch {
    return null;
  }
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
  if (HEADSHOT_HOST_RE.test(url)) return true;
  if (HEADSHOT_URL_RE.test(url)) return true;
  if (alt && /\b(author|byline|headshot|mug|profile|portrait)\b/i.test(alt)) return true;

  const { w, h } = parseWHFromUrl(url);
  if (w && h) {
    const ar = w / h;
    const squareish = Math.abs(ar - 1) <= 0.2;
    const tiny = Math.max(w, h) <= 220; // most byline avatars are <= 200–220px
    if (squareish && tiny) return true;
    // Reject very small/near-square editorial mug sizes even when bigger than 220
    if (squareish && w * h < 140_000) return true; // e.g., 320x320
  }
  return false;
}

// Strengthen your existing weak check
export function isWeakArticleImage(url: string, alt?: string | null): boolean {
  if (!url) return true;
  const s = url.trim();

  // reject non-http(s) and svgs as you already do
  if (!/^https?:\/\//i.test(s)) return true;
  if (/\.svg(\?|#|$)/i.test(s)) return true;

  // explicit thumbs/logos/icons
  if (THUMB_URL_RE.test(s)) return true;

  // author headshots / avatars
  if (isLikelyAuthorHeadshot(s, alt)) return true;

  // extremely small by filename hints (like 120x120)
  const { w, h } = parseWHFromUrl(s);
  if (w && h) {
    if (w < 240 || h < 160) return true; // too small for article hero
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
      p.endsWith("/headshot.jpg")
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
