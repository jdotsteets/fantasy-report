// lib/images.ts

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


/** Extracts a likely person name from a headline (best-effort). */
const STOP_WORDS = new Set([
  "diagnosed","with","out","vs","at","ruled","placed","signs","agrees","trade",
  "injury","injured","activated","reinstated","questionable","doubtful","probable",
  "update","news","notes","expected","likely","season","game","practice","status",
  "listed","concussion","hamstring","ankle","knee","groin","back","fracture","tear",
]);

function cleanPrefix(t: string) {
  return t.replace(/^[A-Za-z ]+:\s+/, ""); // “Report: …”
}

export function extractLikelyNameFromTitle(title: string): string | null {
  const t = cleanPrefix(title).replace(/’/g, "'").replace(/'s\b/g, "");
  const words = t.split(/\s+/);
  const parts: string[] = [];

  for (const raw of words) {
    const w = raw.replace(/[^\w'-]/g, "");
    if (!w) continue;
    const lower = w.toLowerCase();

    if (parts.length > 0 && (STOP_WORDS.has(lower) || ["-", "—"].includes(w))) break;

    const isCap = /^[A-Z][a-z'-]*$/.test(w);
    if (isCap) {
      parts.push(w);
      if (parts.length === 3) break;
      continue;
    }
    if (parts.length > 0) break;
  }

  if (parts.length >= 2) return parts.join(" ");
  if (parts.length === 1) return parts[0];
  return null;
}

/** Favicon/low-value image detector. */
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
