// lib/dates/htmlExtractors.ts
import type { CheerioAPI } from "cheerio";
import { load } from "cheerio";
import { DateTime, type DurationLikeObject } from "luxon";
import type { DateCandidate, PublishedSource } from "./types";
import { mkCandidate, score } from "./parse";

export function loadHtml(html: string): CheerioAPI {
  return load(html);
}

/** JSON-LD: datePublished/dateCreated/dateModified (handles @graph and arrays) */
export function extractFromJsonLD($: CheerioAPI): DateCandidate[] {
  const out: DateCandidate[] = [];

  const flatten = (node: unknown, acc: any[] = []): any[] => {
    if (!node) return acc;
    if (Array.isArray(node)) {
      node.forEach((n) => flatten(n, acc));
      return acc;
    }
    if (typeof node === "object") {
      acc.push(node as any);
      const g = (node as any)["@graph"] ?? (node as any).graph;
      if (g) flatten(g, acc);
    }
    return acc;
  };

  $('script[type="application/ld+json"]').each((_, el) => {
    const txt = $(el).text();
    try {
      const json = JSON.parse(txt);
      const objs = flatten(json);
      for (const t of objs) {
        const raw: unknown =
          (t as any)?.datePublished ??
          (t as any)?.dateCreated ??
          (t as any)?.dateModified;
        if (typeof raw === "string") {
          const src: PublishedSource =
            (t as any)?.dateModified === raw ? "modified" : "jsonld";
          const cand = mkCandidate(raw, src);
          if (cand) out.push(cand);
        }
      }
    } catch {
      /* ignore malformed JSON-LD */
    }
  });

  return out;
}

/** Meta tags: og:published_time, article:published_time, etc. */
export function extractFromMeta($: CheerioAPI): DateCandidate[] {
  const get = (sel: string) => ($(sel).attr("content") ?? "").trim();
  const cands: DateCandidate[] = [];

  const tryPush = (raw: string | null, source: PublishedSource) => {
    if (!raw) return;
    const c = mkCandidate(raw, source);
    if (c) cands.push(c);
  };

  // OpenGraph / Article
  tryPush(
    get('meta[property="article:published_time"], meta[property="og:published_time"]'),
    "og"
  );
  tryPush(
    get('meta[property="article:modified_time"], meta[property="og:updated_time"]'),
    "modified"
  );

  // Generic/meta name variants
  tryPush(get('meta[name="date"], meta[name="publish-date"], meta[name="pubdate"]'), "meta");
  tryPush(get('meta[itemprop="datePublished"]'), "meta");
  tryPush(get('meta[name="parsely-pub-date"]'), "meta"); // Parse.ly
  tryPush(
    get('meta[name="publication_date"], meta[name="publish_date"], meta[name="pub_date"]'),
    "meta"
  );
  tryPush(get('meta[name="sailthru.date"]'), "meta"); // Sailthru

  // Dublin Core variants
  tryPush(get('meta[name="dc.date"], meta[name="dc.date.issued"], meta[name="dcterms.created"]'), "dc");

  return cands;
}

/** <time datetime="..."> */
export function extractFromTimeTag($: CheerioAPI): DateCandidate[] {
  const out: DateCandidate[] = [];
  $("time[datetime]").each((_, el) => {
    const raw = $(el).attr("datetime");
    if (raw) {
      const c = mkCandidate(raw, "time-tag");
      if (c) out.push(c);
    }
  });
  return out;
}

/** Visible “Published …” strings (e.g., "Published 09/15/2025"). */
export function extractFromPublishedLabel($: CheerioAPI): DateCandidate[] {
  const out: DateCandidate[] = [];
  const body = $("body").text() ?? "";

  const patterns: RegExp[] = [
    /Published\s*(?:on\s*)?[:\-]?\s*([A-Za-z]{3,9}\s+\d{1,2},\s+\d{4})/i,  // September 15, 2025
    /Published\s*(?:on\s*)?[:\-]?\s*((?:\d{1,2})[\/-](?:\d{1,2})[\/-](?:\d{2,4}))/i, // 09/15/25
    /Published\s*(?:on\s*)?[:\-]?\s*(\d{4}-\d{2}-\d{2})/i,               // 2025-09-15
  ];

  const tryFormats = (s: string): string | null => {
    const candidates = [
      "M/d/yyyy", "MM/dd/yyyy", "M/d/yy", "MM/dd/yy",
      "LLLL d, yyyy", "LLL d, yyyy", "yyyy-MM-dd",
    ];
    for (const f of candidates) {
      const dt = DateTime.fromFormat(s.trim(), f, { zone: "utc" });
      if (dt.isValid) return dt.toUTC().toISO();
    }
    return null;
  };

  for (const re of patterns) {
    const m = body.match(re);
    if (m && m[1]) {
      const iso = tryFormats(m[1]) ?? mkCandidate(m[1], "meta")?.iso ?? null;
      if (iso) {
        out.push({
          iso,
          raw: m[1],
          source: "meta",
          confidence: score("meta"),
          tz: null,
        });
        break;
      }
    }
  }
  return out;
}

/** Relative phrases like “6h ago”, “45m ago”, “2 days ago” */
export function extractFromRelativeAgo($: CheerioAPI, nowIso?: string | null): DateCandidate[] {
  const out: DateCandidate[] = [];
  const body = $("body").text() ?? "";

  // Examples: "Updated 2h ago", "Published 45m ago", "3 hours ago"
  const rx =
    /(?:Published|Updated)?\s*(\d+)\s*(sec|secs|second|seconds|min|mins|minute|minutes|hr|hrs|hour|hours|h|m|day|days|week|weeks|month|months|year|years)\s*ago/i;
  const m = body.match(rx);
  if (!m) return out;

  const amount = Number(m[1]);
  const unitRaw = m[2].toLowerCase();

  const unitMap: Record<string, keyof DurationLikeObject> = {
    sec: "seconds",
    secs: "seconds",
    second: "seconds",
    seconds: "seconds",
    min: "minutes",
    mins: "minutes",
    minute: "minutes",
    minutes: "minutes",
    m: "minutes",
    hr: "hours",
    hrs: "hours",
    hour: "hours",
    hours: "hours",
    h: "hours",
    day: "days",
    days: "days",
    week: "weeks",
    weeks: "weeks",
    month: "months",
    months: "months",
    year: "years",
    years: "years",
  };
  const unit = unitMap[unitRaw];
  if (!unit) return out;

  const now = nowIso ? DateTime.fromISO(nowIso, { zone: "utc" }) : DateTime.utc();
  const dt = now.minus({ [unit]: amount } as DurationLikeObject).toUTC();
  if (!dt.isValid) return out;

  out.push({
    iso: dt.toISO()!,
    raw: m[0],
    source: "meta",               // treat relative text as meta-derived
    confidence: score("relative"),
    tz: "UTC",
  });
  return out;
}
