// lib/dates/parse.ts
import { DateTime } from "luxon";
import type { DateCandidate, PublishedSource } from "./types";

function toISO(raw: string, tzGuess?: string | null): string | null {
  // Try as ISO first
  let dt = DateTime.fromISO(raw, { zone: tzGuess ?? "utc" });
  if (!dt.isValid) {
    // RSS/HTTP style
    dt = DateTime.fromRFC2822(raw, { zone: tzGuess ?? "utc" });
  }
  if (!dt.isValid) {
    // Atom-style generic
    dt = DateTime.fromHTTP(raw, { zone: tzGuess ?? "utc" });
  }
  if (!dt.isValid) return null;
  return dt.toUTC().toISO();
}

export function score(source: PublishedSource): number {
  // Tuneable priority
  switch (source) {
    case "rss":
    case "atom":
    case "dc":
      return 95;
    case "jsonld":
      return 90;
    case "og":
    case "meta":
      return 80;
    case "time-tag":
      return 70;
    case "url":
      return 60;
    case "sitemap":
      return 50;
    case "modified":
      return 40;
    default:
      return 0;
  }
}

export function mkCandidate(raw: string, source: PublishedSource, tz?: string | null): DateCandidate | null {
  const iso = toISO(raw, tz);
  if (!iso) return null;
  return { iso, raw, source, confidence: score(source), tz: tz ?? null };
}

const URL_DATE_RE = [
  /\b(\d{4})[/-](\d{1,2})[/-](\d{1,2})\b/,         // 2024/09/03 or 2024-09-03
  /\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/,         // 09/03/2024 or 09-03-2024
];

export function extractFromUrl(url: string): DateCandidate | null {
  for (const re of URL_DATE_RE) {
    const m = url.match(re);
    if (m) {
      // Normalize components
      let y: number, mo: number, d: number;
      if (m[1].length === 4) {
        y = Number(m[1]); mo = Number(m[2]); d = Number(m[3]);
      } else {
        y = Number(m[3]); mo = Number(m[1]); d = Number(m[2]);
      }
      const dt = DateTime.fromObject({ year: y, month: mo, day: d }, { zone: "utc" });
      if (dt.isValid) {
        return { iso: dt.toISO(), raw: m[0], source: "url", confidence: score("url"), tz: null };
      }
    }
  }
  return null;
}

export function pickBest(cands: DateCandidate[]): DateCandidate | null {
  if (cands.length === 0) return null;
  // Prefer highest confidence; tie-break with earliest valid time in case of equal confidence
  return cands
    .slice()
    .sort((a, b) =>
      b.confidence !== a.confidence
        ? b.confidence - a.confidence
        : Date.parse(a.iso) - Date.parse(b.iso)
    )[0];
}
