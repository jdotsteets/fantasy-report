// lib/enrich.ts
import crypto from "crypto";
import slugify from "slugify";

export type RawItem = { link?: string; title?: string; isoDate?: string };

/* -----------------------
   URL normalization
------------------------ */

const BAD_PARAMS = [
  /^utm_/i, /^fbclid$/i, /^gclid$/i, /^mc_cid$/i, /^mc_eid$/i,
  /^ref$/i, /^cn$/i, /^cmp$/i, /^igshid$/i
];

export function normalizeUrl(raw: string): {
  url: string;
  canonical: string;
  domain: string;
} {
  try {
    const u = new URL(raw.trim());
    // Drop junk query params
    BAD_PARAMS.forEach((re) => {
      for (const key of Array.from(u.searchParams.keys())) {
        if (re.test(key)) u.searchParams.delete(key);
      }
    });
    // No hash fragments
    u.hash = "";
    // Trim trailing slash (not root)
    let canonical = u.toString();
    if (canonical.endsWith("/") && u.pathname !== "/") {
      canonical = canonical.slice(0, -1);
    }
    const domain = u.hostname.replace(/^www\./, "");
    return { url: raw.trim(), canonical, domain };
  } catch {
    return { url: raw, canonical: raw, domain: "" };
  }
}

/* -----------------------
   Title cleaning
------------------------ */

// Generic publisher suffix patterns we strip from titles
const PUBLISHER_SUFFIXES = [
  /\s*[-–—]\s*fantasypros.*$/i,
  /\s*[-–—]\s*cbs sports.*$/i,
  /\s*[-–—]\s*yahoo sports.*$/i,
  /\s*[-–—]\s*rotowire.*$/i,
  /\s*[-–—]\s*numberfire.*$/i,
  /\s*[-–—]\s*nbc sports edge.*$/i,
  /\s*\|\s*.*$/i, // trailing pipes like " | Fantasy Football"
];

// Base cleaner
export function cleanTitle(t: string): string {
  let s = (t || "").replace(/\s+/g, " ").trim();
  for (const re of PUBLISHER_SUFFIXES) s = s.replace(re, "");
  return s.trim();
}

// Optional per‑source rules
const bySourceCleaners: Record<string, (t: string) => string> = {
  "Yahoo Sports NFL": (t) => t.replace(/\s*-\s*Yahoo Sports.*$/i, ""),
  "Rotowire NFL": (t) => t.replace(/\s*-\s*RotoWire.*$/i, ""),
  // add more as needed…
};

export function cleanTitleForSource(source: string, title: string) {
  const base = cleanTitle(title);
  const fn = bySourceCleaners[source];
  return fn ? fn(base) : base;
}

/* -----------------------
   Week inference
------------------------ */

// Matches: Week 3, week-3, Wk 3, wk3, etc.
const WEEK_RE = /\b(?:week|wk)\s*[-.]?\s*(\d{1,2})\b/i;

/**
 * Infer week number from the title. If none is found and we’re in
 * July or August (UTC), treat it as preseason week 0 so those items
 * still show up when you filter by "current week".
 */
export function inferWeek(title: string, now = new Date()): number | null {
  const m = (title || "").match(WEEK_RE);
  if (m) {
    const n = parseInt(m[1], 10);
    return Math.min(18, Math.max(1, n)); // clamp 1..18
  }

  // Preseason fallback: July (6) or August (7) in UTC
  const month = now.getUTCMonth();
  if (month === 6 || month === 7) return 0;

  return null;
}

/* -----------------------
   Topic classification
------------------------ */

export function classify(title: string): string[] {
  const t = (title || "").toLowerCase();

  // Waivers
  if (/\bwaivers?|streamers?|adds?|pickups?\b/.test(t)) {
    return ["waiver-wire"];
  }

  // Rankings / tiers
  if (/\brankings?\b|\btiers?\b|\becr\b/.test(t)) {
    return ["rankings"];
  }

  // Start/Sit & Sleepers (group sleepers here so it appears in the left column)
  if (
    /\bstart(?:\/| and | & )?sit|sit\/start|start-sit\b/.test(t) ||
    /\bsleepers?\b/.test(t)
  ) {
    return ["start-sit"];
  }

  // Trades / ROS (rest-of-season) chatter often belongs here
  if (/\btrade|buy\s+low|sell\s+high|rest[-\s]?of[-\s]?season\b/.test(t)) {
    return ["trade"];
  }

  // Injuries
  if (/\binjur(?:y|ies)|inactives?|questionable|practice report\b/.test(t)) {
    return ["injury"];
  }

  // DFS
  if (/\bdfs|draftkings|fanduel|cash game|gpp\b/.test(t)) {
    return ["dfs"];
  }

  return ["news"];
}

/* -----------------------
   Dates / Slugs / Fingerprints
------------------------ */

export function parseDate(iso?: string | null, fallbackNow = true): string | null {
  if (iso) {
    const d = new Date(iso);
    if (!isNaN(+d)) return d.toISOString();
  }
  return fallbackNow ? new Date().toISOString() : null;
}

export function makeSlug(sourceName: string, title: string, canonical: string): string {
  const base = title || canonical;
  const s = slugify(`${sourceName} ${base}`.slice(0, 80), { lower: true, strict: true });
  return s || crypto.createHash("sha1").update(canonical).digest("hex").slice(0, 10);
}

export function fingerprint(canonical: string, title: string): string {
  const key = `${canonical}|${cleanTitle(title)}`;
  return crypto.createHash("sha1").update(key).digest("hex");
}

/* -----------------------
   Main enrichment
------------------------ */

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
