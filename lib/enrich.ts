// lib/enrich.ts
import crypto from "crypto";
import slugify from "slugify";

export type RawItem = { link?: string; title?: string; isoDate?: string };

// Query params we strip from URLs
const BAD_PARAMS = [
  /^utm_/i, /^fbclid$/i, /^gclid$/i, /^mc_cid$/i, /^mc_eid$/i,
  /^ref$/i, /^cn$/i, /^cmp$/i, /^igshid$/i
];

export function normalizeUrl(raw: string): { url: string; canonical: string; domain: string } {
  try {
    const u = new URL(raw.trim());
    // drop junk params
    BAD_PARAMS.forEach((re) => {
      for (const key of Array.from(u.searchParams.keys())) {
        if (re.test(key)) u.searchParams.delete(key);
      }
    });
    u.hash = "";
    // trim trailing slash but not the root
    let canonical = u.toString();
    if (canonical.endsWith("/") && u.pathname !== "/") canonical = canonical.slice(0, -1);
    const domain = u.hostname.replace(/^www\./, "");
    return { url: raw.trim(), canonical, domain };
  } catch {
    return { url: raw, canonical: raw, domain: "" };
  }
}

// Generic publisher suffix patterns to remove from titles
const PUBLISHER_SUFFIXES = [
  /\s*[-–—]\s*fantasypros.*$/i,
  /\s*[-–—]\s*cbs sports.*$/i,
  /\s*[-–—]\s*yahoo sports.*$/i,
  /\s*[-–—]\s*rotowire.*$/i,
  /\s*[-–—]\s*numberfire.*$/i,
  /\s*[-–—]\s*nbc sports edge.*$/i,
];

// Base title cleaner
export function cleanTitle(t: string): string {
  let s = (t || "").replace(/\s+/g, " ").trim();
  for (const re of PUBLISHER_SUFFIXES) s = s.replace(re, "");
  // remove trailing pipes like “| Fantasy Football”
  s = s.replace(/\s*\|\s*.*$/i, "");
  return s.trim();
}

// Optional per-source rules (add more as needed)
const bySourceCleaners: Record<string, (t: string) => string> = {
  "Yahoo Sports NFL": (t) => t.replace(/\s*-\s*Yahoo Sports.*$/i, ""),
  "Rotowire NFL": (t) => t.replace(/\s*-\s*RotoWire.*$/i, ""),
};

// Per-source title cleaner wrapper
export function cleanTitleForSource(source: string, title: string) {
  const base = cleanTitle(title);
  const fn = bySourceCleaners[source];
  return fn ? fn(base) : base;
}

// Week: “Week 3”, “week-3”, “Wk 3”, “week3”
export function inferWeek(title: string): number | null {
  const t = title.toLowerCase();
  const m = t.match(/\b(?:week|wk)[\s\-]*?(\d{1,2})\b/);
  return m ? Math.min(18, Math.max(1, parseInt(m[1], 10))) : null;
}

// Topic classifier
export function classify(title: string): string[] {
  const t = (title || "").toLowerCase();
  if (/\bwaiver|streamers?|adds?|pickups?\b/.test(t)) return ["waiver-wire"];
  if (/\brankings?|tiers?\b/.test(t) || /\becr\b/.test(t)) return ["rankings"];
  if (/\bstart(?:\/| and )sit|sit\/start|start-sit\b/.test(t)) return ["start-sit"];
  if (/\btrade|buy\s+low|sell\s+high|rest[-\s]?of[-\s]?season\b/.test(t)) return ["trade"];
  if (/\binjur(y|ies)|inactives?|questionable|practice report\b/.test(t)) return ["injury"];
  if (/\bdfs|draftkings|fanduel|cash game|gpp\b/.test(t)) return ["dfs"];
  return ["news"];
}

// Date parser (fallback to now)
export function parseDate(iso?: string | null, fallbackNow = true): string | null {
  if (iso) {
    const d = new Date(iso);
    if (!isNaN(+d)) return d.toISOString();
  }
  return fallbackNow ? new Date().toISOString() : null;
}

// Slug builder
export function makeSlug(sourceName: string, title: string, canonical: string): string {
  const base = title || canonical;
  const s = slugify(`${sourceName} ${base}`.slice(0, 80), { lower: true, strict: true });
  return s || crypto.createHash("sha1").update(canonical).digest("hex").slice(0, 10);
}

// Content fingerprint (for dedupe/scoring)
export function fingerprint(canonical: string, title: string): string {
  const key = `${canonical}|${cleanTitle(title)}`;
  return crypto.createHash("sha1").update(key).digest("hex");
}

// Main enrichment function
export function enrich(sourceName: string, item: RawItem) {
  const rawUrl = item.link || "";
  const { url, canonical, domain } = normalizeUrl(rawUrl);

  const cleaned = cleanTitleForSource(sourceName, item.title || canonical);
  const topics = classify(cleaned);
  const week = inferWeek(cleaned);
  const published_at = parseDate(item.isoDate, true);
  const slug = makeSlug(sourceName, cleaned, canonical);
  const fp = fingerprint(canonical, cleaned);

  return {
    url,
    canonical_url: canonical,
    domain,
    title: item.title || "",
    cleaned_title: cleaned,
    topics,
    week,
    published_at,
    slug,
    fingerprint: fp,
  };
}
