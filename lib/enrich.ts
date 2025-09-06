// lib/enrich.ts
import crypto from "crypto";
import slugify from "slugify";
import { getSafeImageUrl, isLikelyFavicon, extractLikelyNameFromTitle } from "@/lib/images";
import { findArticleImage } from "@/lib/scrape-image";
import { findWikipediaHeadshot } from "@/lib/wiki";

/** Minimal feed item we get from rss-parser (etc.), extended with media fields */
export type RawItem = {
  link?: string;
  title?: string;
  isoDate?: string;
  // common RSS media fields (rss-parser may map these differently by feed)
  enclosure?: { url?: string | null } | null;
  ["media:content"]?: { url?: string | null } | { url?: string | null }[] | null;
};

// Minimal HTML entity decoder for common cases
export function decodeEntities(raw: string): string {
  if (!raw) return raw;
  let s = raw;

  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
  };

  const decodeOnce = (str: string) =>
    str.replace(/&(#x?[0-9a-f]+|[a-z]+);?/gi, (m, ent) => {
      const t = ent.toLowerCase();
      if (t in named) return named[t];
      if (t.startsWith("#x")) {
        const code = parseInt(t.slice(2), 16);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      if (t.startsWith("#")) {
        const code = parseInt(t.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return m;
    });

  for (let i = 0; i < 2; i++) {
    const next = decodeOnce(s);
    if (next === s) break;
    s = next;
  }

  s = s
    .replace(/\u00A0/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[“”„‟]/g, '"')
    .replace(/[’‘‚‛]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  return s;
}

/** Shape of the enriched article we return to callers */
export type Enriched = {
  url: string;
  canonical_url: string;
  domain: string;
  title: string;
  cleaned_title: string;
  topics: string[];
  week: number | null;
  published_at: string | null;
  slug: string;
  fingerprint: string;
  image_url: string | null;
};


// ——— tiny helpers (no `any`) ———

// add near the other helpers
const URL_YMD = /\/(20\d{2})\/([01]?\d)\/([0-3]?\d)(?:\/|$)/; // /YYYY/MM/DD/
const URL_YEAR = /\/(20\d{2})(?:\/|$)/;                        // /YYYY/

function inferDateFromUrl(u: string): string | null {
  try {
    const url = new URL(u);
    const p = url.pathname;
    const m1 = p.match(URL_YMD);
    if (m1) {
      const y = +m1[1], m = +m1[2], d = +m1[3];
      if (y >= 2005 && y <= new Date().getFullYear() + 1 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
        return new Date(Date.UTC(y, m - 1, d)).toISOString();
      }
    }
    const m2 = p.match(URL_YEAR);
    if (m2) {
      const y = +m2[1];
      if (y >= 2005 && y <= new Date().getFullYear() + 1) {
        // assume Jan 1 for ordering purposes
        return new Date(Date.UTC(y, 0, 1)).toISOString();
      }
    }
  } catch {}
  return null;
}


function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function urlString(v: unknown): string | null {
  return typeof v === "string" && /^https?:\/\//i.test(v) ? v : null;
}

function firstUrlFrom(value: unknown): string | null {
  // handles string | {url} | {href} | Array<...> | null
  if (urlString(value)) return value as string;

  const obj = asRecord(value);
  if (obj) {
    if (urlString(obj.url)) return obj.url as string;
    if (urlString(obj.href)) return obj.href as string;
    // RSS libraries often put content in arrays
    const arrLike = (k: string) => {
      const v = obj[k];
      if (Array.isArray(v)) {
        for (const el of v) {
          const u = firstUrlFrom(el);
          if (u) return u;
        }
      }
      return null;
    };
    const viaContent = arrLike("content");
    if (viaContent) return viaContent;
    const viaThumbnail = arrLike("thumbnail");
    if (viaThumbnail) return viaThumbnail;
  }

  if (Array.isArray(value)) {
    for (const el of value) {
      const u = firstUrlFrom(el);
      if (u) return u;
    }
  }
  return null;
}

/** enclosure / "rss:enclosure" / "enclosures" */
function imageFromEnclosure(item: unknown): string | null {
  const rec = asRecord(item);
  if (!rec) return null;

  const candidates: Array<unknown> = [
    rec.enclosure,
    rec["rss:enclosure"],
    rec.enclosures,
  ].filter((v) => v != null);

  for (const c of candidates) {
    const u = firstUrlFrom(c);
    if (u) return u;
  }
  return null;
}

/** media:content / media:thumbnail / media.group / image / image_url */
function imageFromMedia(item: unknown): string | null {
  const rec = asRecord(item);
  if (!rec) return null;

  // direct keys commonly emitted by feed parsers
  const directKeys = [
    "media:content",
    "media:thumbnail",
    "media:group",
    "image",
    "image_url",
    "og:image",
    "twitter:image",
  ] as const;

  for (const k of directKeys) {
    const u = firstUrlFrom(rec[k]);
    if (u) return u;
  }

  // nested "media" object
  const media = asRecord(rec.media);
  if (media) {
    const u =
      firstUrlFrom(media.content) ??
      firstUrlFrom(media.thumbnail) ??
      firstUrlFrom(media.group);
    if (u) return u;
  }
  return null;
}


/* -----------------------
   image capture (improved)
------------------------ */

function resolveImageUrl(raw: string, pageUrl: string): string | null {
  if (!raw) return null;
  let u = raw.trim();
  if (u.startsWith("//")) u = "https:" + u; // protocol-relative -> https
  try {
    return new URL(u, pageUrl).toString();
  } catch {
    return null;
  }
}

/** Try to fetch an article's lead image via common meta/link tags. */
export async function fetchOgImage(pageUrl: string, timeoutMs = 4000): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(pageUrl, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      },
    });
    if (!res.ok) return null;

    const ctype = res.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml\+xml/i.test(ctype)) return null;

    const html = await res.text();
    const doc = html.slice(0, 400_000);

    const pick = (re: RegExp) => {
      const m = doc.match(re);
      return m?.[1] ? resolveImageUrl(m[1], pageUrl) : null;
    };

    return (
      pick(/<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["']/i) ||
      pick(/<meta[^>]+property=["']og:image:url["'][^>]+content=["']([^"']+)["']/i) ||
      pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
      pick(/<meta[^>]+name=["']twitter:image:src["'][^>]+content=["']([^"']+)["']/i) ||
      pick(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i) ||
      pick(/<meta[^>]+itemprop=["']image["'][^>]+content=["']([^"']+)["']/i) ||
      pick(/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i) ||
      null
    );
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function faviconFor(domain: string): string | null {
  if (!domain) return null;
  return `https://${domain}/favicon.ico`;
}

/* -----------------------
   URL normalization
------------------------ */

const BAD_PARAMS = [
  /^utm_/i, /^fbclid$/i, /^gclid$/i, /^mc_cid$/i, /^mc_eid$/i,
  /^ref$/i, /^cn$/i, /^cmp$/i, /^igshid$/i,
];

export function normalizeUrl(raw: string): {
  url: string;
  canonical: string;
  domain: string;
} {
  try {
    const u = new URL(raw.trim());

    BAD_PARAMS.forEach((re) => {
      for (const key of Array.from(u.searchParams.keys())) {
        if (re.test(key)) u.searchParams.delete(key);
      }
    });

    u.hash = "";

    let canonical = u.toString();
    if (canonical.endsWith("/") && u.pathname !== "/") canonical = canonical.slice(0, -1);

    const domain = u.hostname.replace(/^www\./, "");
    return { url: raw.trim(), canonical, domain };
  } catch {
    return { url: raw, canonical: raw, domain: "" };
  }
}

/* -----------------------
   Title cleaning
------------------------ */

const PUBLISHER_SUFFIXES = [
  /\s*[-–—]\s*fantasypros.*$/i,
  /\s*[-–—]\s*cbs sports.*$/i,
  /\s*[-–—]\s*yahoo sports.*$/i,
  /\s*[-–—]\s*rotowire.*$/i,
  /\s*[-–—]\s*numberfire.*$/i,
  /\s*[-–—]\s*nbc sports edge.*$/i,
  /\s*\|\s*.*$/i,
];

export function cleanTitle(t: string): string {
  let s = decodeEntities((t || "").replace(/\s+/g, " ").trim());
  for (const re of PUBLISHER_SUFFIXES) s = s.replace(re, "");
  return s.trim();
}

const bySourceCleaners: Record<string, (t: string) => string> = {
  "Yahoo Sports NFL": (t) => t.replace(/\s*-\s*Yahoo Sports.*$/i, ""),
  "Rotowire NFL": (t) => t.replace(/\s*-\s*RotoWire.*$/i, ""),
};

export function cleanTitleForSource(source: string, title: string) {
  const base = cleanTitle(title);
  const fn = bySourceCleaners[source];
  return fn ? fn(base) : base;
}

/* -----------------------
   Week inference
------------------------ */

// will also look in URL path if provided
const WEEK_RE = /\b(?:week|wk)[\s\-._]*([0-9]{1,2})\b/i;

export function inferWeek(title: string, now = new Date(), pageUrl?: string): number | null {
  const hay = `${title || ""} ${pageUrl ? new URL(pageUrl, "https://x").pathname : ""}`;
  const m = hay.match(WEEK_RE);
  if (m) {
    const n = parseInt(m[1], 10);
    return Math.min(18, Math.max(1, n));
  }
  const month = now.getUTCMonth();
  if (month === 6 || month === 7) return 0;
  return null;
}

/* -----------------------
   Topic classification
------------------------ */

// URL-aware hints (path and query only; hostname is used sparingly)
function tagsFromUrl(pageUrl?: string | null): string[] {
  if (!pageUrl) return [];
  let u: URL | null = null;
  try { u = new URL(pageUrl); } catch { return []; }

  const path = `${u.pathname}`.toLowerCase();
  const q = `${u.search}`.toLowerCase();
  const host = u.hostname.replace(/^www\./, "").toLowerCase();

  const tags: string[] = [];

  const has = (re: RegExp) => re.test(path) || re.test(q);

  if (has(/\binjur(y|ies)|inactives?|practice[-_]report|designation\b/)) tags.push("injury");
  if (has(/\bwaiver[-_ ]?wire|waivers?|adds?|streamers?\b/)) tags.push("waiver-wire");
  if (has(/\bstart[-_ ]?sit|sit[-_ ]?start|streamers?\b/)) tags.push("start-sit");
  if (has(/\bdfs\b|draftkings|fan[-_ ]?duel|cash[-_ ]?game|gpp\b/)) tags.push("dfs");
  if (has(/\brankings?\b|\btiers?\b|\becr\b/)) tags.push("rankings");
  if (has(/\bmock[-_ ]?draft|draft[-_ ]?(kit|guide|strategy|plan|tips|targets|values)|\badp\b|cheat[-_ ]?sheet\b/)) {
    if (!tags.includes("rankings") && has(/\badp|tiers?\b/)) tags.push("rankings");
    tags.push("draft-prep");
  }
  if (has(/\btrade(s|)|buy[-_ ]?sell|sell[-_ ]?high|buy[-_ ]?low|risers[-_ ]?and[-_ ]?fallers|targets?\b/)) {
    tags.push("advice");
    if (!tags.includes("trade")) tags.push("trade");
  }

  // a few domain nudges (very light touch)
  if (/rotowire\.com|fantasypros\.com|numberfire\.com/.test(host)) {
    if (has(/\brankings?\b/)) tags.push("rankings");
  }

  return Array.from(new Set(tags));
}

/** Backward-compatible: still works with just (title), but can take (title, pageUrl). */
export function classify(title: string, pageUrl?: string | null): string[] {
  const t = (title || "").toLowerCase().trim();
  const tags: string[] = [];

  if (/\b(waiver\s*wire|pick\s*ups?|adds?|streamers?|deep\s*adds?|stash(?:es)?|faab|sleepers?|targets?|spec\s*adds?|roster\s*moves?)\b/.test(t)) {
    tags.push("waiver-wire");
  }

  if (
    /\bstart(?:\/| and | & )?sit|sit\/start|start-?sit\b/.test(t) ||
    /\bsleepers?\b/.test(t)
  ) {
    tags.push("start-sit");
  }

  if (/\binjur(?:y|ies)|inactives?|questionable|practice report\b/.test(t)) {
    tags.push("injury");
  }

  if (/\bdfs|draftkings|fan(?:duel| duel)|cash game|gpp\b/.test(t)) {
    tags.push("dfs");
  }

  if (/\btrade|ros\b|rest[-\s]?of[-\s]?season\b/.test(t)) {
    tags.push("trade");
  }

  if (/\brankings?\b|\btiers?\b|\becr\b/.test(t)) {
    tags.push("rankings");
  }

  if (
    /\bmock drafts?\b|\bmock draft\b/.test(t) ||
    /\badp\b/.test(t) ||
    /\bdraft (?:kit|guide|strategy|plan|tips|targets|values)\b/.test(t) ||
    /\bcheat ?sheets?\b/.test(t) ||
    /\bdraft board\b/.test(t)
  ) {
    if (!tags.includes("rankings") && /\badp|tiers?\b/.test(t)) {
      tags.push("rankings");
    }
    tags.push("draft-prep");
  }

  if (
    /\bbuy(?:\/sell| & sell| or sell)?\b/.test(t) ||
    /\bsell candidates?\b/.test(t) ||
    /\btrade targets?\b/.test(t) ||
    /\brisers?\b/.test(t) ||
    /\bfallers?\b/.test(t) ||
    /\bplayers? to (watch|avoid|target)\b/.test(t)
  ) {
    tags.push("advice");
  }

  // merge in URL-derived hints
  for (const tag of tagsFromUrl(pageUrl)) {
    if (!tags.includes(tag)) tags.push(tag);
  }

  if (tags.length === 0) tags.push("news");
  return tags;
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
   Main enrichment (improved image selection + URL-aware topics)
------------------------ */

export async function enrich(sourceName: string, item: RawItem): Promise<Enriched> {
  const rawUrl = item.link || "";
  const { url, canonical, domain } = normalizeUrl(rawUrl);

  const cleaned      = cleanTitleForSource(sourceName, item.title || canonical);
  const topics       = classify(cleaned, canonical);          // 👈 include URL hints
  const week         = inferWeek(cleaned, new Date(), canonical); // 👈 URL can hint week too
  const published_at =
  parseDate(item.isoDate, false) ??
  inferDateFromUrl(canonical) ??
  null;
  const slug         = makeSlug(sourceName, cleaned, canonical);
  const fp           = fingerprint(canonical, cleaned);

  // 1) candidates coming directly from the feed
  const directFromEnclosure = imageFromEnclosure(item);
  const directFromMedia = imageFromMedia(item);

  const feedCandidates: Array<string> = [];
  if (directFromEnclosure) feedCandidates.push(directFromEnclosure);
  if (directFromMedia) feedCandidates.push(directFromMedia);

  // helper to take the first safe, non-favicon candidate
  function firstSafe(cands: ReadonlyArray<string>): string | null {
    for (const c of cands) {
      const safe = getSafeImageUrl(c);
      if (safe && !isLikelyFavicon(safe)) return safe;
    }
    return null;
  }

  let image_url: string | null = firstSafe(feedCandidates);

  // 2) OpenGraph / Twitter meta (best-effort)
  if (!image_url) {
    const og = await fetchOgImage(canonical).catch(() => null);
    image_url = getSafeImageUrl(og);
  }

  // 3) Lightweight HTML scrape (meta/JSON-LD/body)
  if (!image_url) {
    const scraped = await findArticleImage(canonical).catch(() => null);
    image_url = getSafeImageUrl(scraped);
  }

  // 4) Wikipedia headshot heuristic for likely player pages
  if (!image_url) {
    const name = extractLikelyNameFromTitle(cleaned); // from lib/images.ts
    if (name) {
      const wiki = await findWikipediaHeadshot(name).catch(() => null);
      image_url = getSafeImageUrl(wiki?.src ?? null);
    }
  }

  // final guard
  if (image_url && isLikelyFavicon(image_url)) {
    image_url = null;
  }

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
    image_url,
  };
}
