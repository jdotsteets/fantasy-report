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

/** Heuristic for weak/likely-bad article images. */
/** Very conservative "junk" detector — do NOT exclude OG/hero images. */
export function isWeakArticleImage(url?: string | null): boolean {
  if (!url) return false;
  try {
    const { pathname } = new URL(url);
    const p = pathname.toLowerCase();

    // Only exclude true boilerplate
    if (p === "/favicon.ico") return true;
    if (p.includes("favicon")) return true;
    if (p.includes("apple-touch-icon")) return true;
    if (p.endsWith(".svg")) return true;

    // Keep "logo" / "placeholder" unless it's the *entire* image path name
    // or the file name is obviously a sprite sheet.
    const file = p.split("/").pop() ?? "";
    if (file.includes("sprite")) return true;

    return false;
  } catch {
    return false;
  }
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
