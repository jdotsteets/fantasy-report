// lib/dates/htmlExtractors.ts
import type { CheerioAPI } from "cheerio";
import { load } from "cheerio";
import { DateTime, type DurationLikeObject } from "luxon";
import type { DateCandidate } from "./types";
import { mkCandidate, score } from "./parse";

export function loadHtml(html: string): CheerioAPI {
  return load(html);
}

/** JSON-LD: datePublished/dateCreated/dateModified */
export function extractFromJsonLD($: CheerioAPI): DateCandidate[] {
  const out: DateCandidate[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const txt = $(el).text();
    try {
      const json = JSON.parse(txt);
      const items = Array.isArray(json) ? json : [json];
      for (const t of items) {
        const raw: unknown =
          (t as Record<string, unknown>)?.datePublished ??
          (t as Record<string, unknown>)?.dateCreated ??
          (t as Record<string, unknown>)?.dateModified;
        if (typeof raw === "string") {
          const src =
            raw === (t as Record<string, unknown>)?.dateModified ? "modified" : "jsonld";
          const cand = mkCandidate(raw, src);
          if (cand) out.push(cand);
        }
      }
    } catch {
      /* ignore bad JSON */
    }
  });
  return out;
}

/** Meta tags: og:published_time, article:published_time, etc. */
export function extractFromMeta($: CheerioAPI): DateCandidate[] {
  const get = (sel: string) => ($(sel).attr("content") ?? "").trim();
  const cands: DateCandidate[] = [];

  const ogPub = get('meta[property="article:published_time"], meta[property="og:published_time"]');
  if (ogPub) {
    const c = mkCandidate(ogPub, "og");
    if (c) cands.push(c);
  }

  const ogMod = get('meta[property="article:modified_time"], meta[property="og:updated_time"]');
  if (ogMod) {
    const c = mkCandidate(ogMod, "modified");
    if (c) cands.push(c);
  }

  const nameDate = get('meta[name="date"], meta[name="publish-date"], meta[name="pubdate"]');
  if (nameDate) {
    const c = mkCandidate(nameDate, "meta");
    if (c) cands.push(c);
  }

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
    /Published\s*(?:on\s*)?[:\-]?\s*([A-Za-z]{3,9}\s+\d{1,2},\s+\d{4})/i, // September 15, 2025
    /Published\s*(?:on\s*)?[:\-]?\s*((?:\d{1,2})[\/-](?:\d{1,2})[\/-](?:\d{2,4}))/i, // 09/15/25
    /Published\s*(?:on\s*)?[:\-]?\s*(\d{4}-\d{2}-\d{2})/i, // 2025-09-15
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
      const iso = tryFormats(m[1]) ?? mkCandidate(m[1], "text")?.iso ?? null;
      if (iso) {
        out.push({ iso, raw: m[1], source: "text", confidence: score("text"), tz: null });
        break;
      }
    }
  }
  return out;
}

/** Relative phrases like “6 hours ago”. */
export function extractFromRelativeAgo($: CheerioAPI, nowIso?: string | null): DateCandidate[] {
  const out: DateCandidate[] = [];
  const body = $("body").text() ?? "";
  const m = body.match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i);
  if (!m) return out;

  const amount = Number.parseInt(m[1], 10);
  const unit = (m[2].toLowerCase() + "s") as keyof DurationLikeObject;

  const now = nowIso ? DateTime.fromISO(nowIso, { zone: "utc" }) : DateTime.utc();
  const dt = now.minus({ [unit]: amount } as DurationLikeObject).toUTC();
  if (!dt.isValid) return out;

  out.push({
    iso: dt.toISO()!,
    raw: m[0],
    source: "relative",
    confidence: score("relative"),
    tz: "UTC",
  });
  return out;
}
