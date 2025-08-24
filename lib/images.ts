// lib/images.ts
export const FALLBACK = "https://yourdomain.com/fallback.jpg";

export function getSafeImageUrl(input?: string | null): string | null {
  if (!input) return FALLBACK;

  let url = input.trim();

  // Fix protocol-relative
  if (url.startsWith("//")) url = "https:" + url;

  // Only reject truly invalid cases
  if (!/^https?:\/\//i.test(url)) return FALLBACK;

  try {
    new URL(url); // will throw if invalid
    return url;
  } catch {
    return FALLBACK;
  }
}


// lib/images.ts (add or extend yours)
export function isWeakArticleImage(url?: string | null) {
  if (!url) return true;
  try {
    const u = new URL(url);
    const p = u.pathname.toLowerCase();
    if (p === "/favicon.ico") return true;
    if (p.includes("favicon")) return true;
    if (p.includes("apple-touch-icon")) return true;
    if (p.includes("sprite") || p.includes("logo")) return true;
    if (p.includes("stock")) return true; // your special-case
    return false;
  } catch {
    return true;
  }
}


// --- helpers: extract a likely person name from a headline ---
const STOP_WORDS = new Set([
  "diagnosed","with","out","vs","at","ruled","placed","signs","agrees","trade",
  "injury","injured","activated","reinstated","questionable","doubtful","probable",
  "update","news","notes","expected","likely","season","game","practice","status",
  "listed","concussion","hamstring","ankle","knee","groin","back","fracture","tear",
]);

function cleanPrefix(t: string) {
  // drop leading "Report:", "Rumor:", "Source:" etc.
  return t.replace(/^[A-Za-z ]+:\s+/, "");
}

export function extractLikelyNameFromTitle(title: string): string | null {
  const t = cleanPrefix(title)
    .replace(/’/g, "'")
    .replace(/'s\b/g, ""); // Rodgers' -> Rodgers

  const words = t.split(/\s+/);

  const nameParts: string[] = [];
  for (const raw of words) {
    const w = raw.replace(/[^\w'-]/g, ""); // strip punctuation around word
    if (!w) continue;

    const lower = w.toLowerCase();

    // stop once we hit a “news word”, but only after we started collecting
    if (nameParts.length > 0 && (STOP_WORDS.has(lower) || ["-", "—"].includes(w))) break;

    // two or three capitalized tokens looks like a name
    const isCap = /^[A-Z][a-z'-]*$/.test(w);
    if (isCap) {
      nameParts.push(w);
      if (nameParts.length === 3) break;
      continue;
    }

    // if we already started and hit a non-capitalized word, stop
    if (nameParts.length > 0) break;
  }

  if (nameParts.length >= 2) return nameParts.join(" ");
  if (nameParts.length === 1) return nameParts[0];
  return null;
}


// lib/images.ts
export function isLikelyFavicon(url?: string | null) {
  if (!url) return false;
  try {
    const { pathname } = new URL(url);
    const p = pathname.toLowerCase();
    return (
      p === "/favicon.ico" ||
      p.includes("favicon") ||
      p.includes("apple-touch-icon") ||
      p.includes("stock-image")
    );
  } catch {
    return false;
  }
}