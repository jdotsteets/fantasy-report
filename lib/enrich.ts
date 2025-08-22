// lib/enrich.ts
import crypto from "crypto";
import slugify from "slugify";

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

const WEEK_RE = /\b(?:week|wk)\s*[-.]?\s*(\d{1,2})\b/i;

export function inferWeek(title: string, now = new Date()): number | null {
  const m = (title || "").match(WEEK_RE);
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

export function classify(title: string): string[] {
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
   Main enrichment (improved image selection)
------------------------ */

export async function enrich(sourceName: string, item: RawItem): Promise<Enriched> {
  const rawUrl = item.link || "";
  const { url, canonical, domain } = normalizeUrl(rawUrl);

  const cleaned      = cleanTitleForSource(sourceName, item.title || canonical);
  const topics       = classify(cleaned);
  const week         = inferWeek(cleaned);
  const published_at = parseDate(item.isoDate, true);
  const slug         = makeSlug(sourceName, cleaned, canonical);
  const fp           = fingerprint(canonical, cleaned);

  // 1) Try direct media from the feed
  const directFromEnclosure = item.enclosure?.url ?? null;
  const mc = item["media:content"];
  const directFromMedia =
    Array.isArray(mc) ? (mc.find((m) => m?.url)?.url ?? null) : (mc?.url ?? null);

  let image_url = directFromEnclosure || directFromMedia || null;

  // 2) Fall back to og:image (and friends)
  if (!image_url) {
    try {
      image_url = await fetchOgImage(canonical);
    } catch {
      /* non-fatal */
    }
  }

  // 3) Favicon fallback
  if (!image_url) image_url = faviconFor(domain);

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
