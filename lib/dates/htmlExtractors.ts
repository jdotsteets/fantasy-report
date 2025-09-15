// lib/dates/htmlExtractors.ts
import type { DateCandidate } from "./types";
import { mkCandidate } from "./parse";

export function extractFromJsonLD(doc: Document): DateCandidate[] {
  const out: DateCandidate[] = [];
  const scripts = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'));
  for (const s of scripts) {
    try {
      const json = JSON.parse(s.textContent || "{}");
      const things = Array.isArray(json) ? json : [json];
      for (const t of things) {
        const raw = t.datePublished ?? t.dateCreated ?? t.dateModified ?? null;
        if (typeof raw === "string") {
          const src = raw === t.dateModified ? "modified" : "jsonld";
          const cand = mkCandidate(raw, src);
          if (cand) out.push(cand);
        }
      }
    } catch {
      // ignore bad JSON
    }
  }
  return out;
}

export function extractFromMeta(doc: Document): DateCandidate[] {
  const get = (sel: string) => (doc.querySelector(sel)?.getAttribute("content") ?? "") || "";
  const cands: DateCandidate[] = [];
  const ogPub = get('meta[property="article:published_time"]');
  if (ogPub) {
    const c = mkCandidate(ogPub, "og");
    if (c) cands.push(c);
  }
  const ogMod = get('meta[property="article:modified_time"]');
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

export function extractFromTimeTag(doc: Document): DateCandidate[] {
  const out: DateCandidate[] = [];
  for (const t of Array.from(doc.querySelectorAll("time[datetime]"))) {
    const raw = t.getAttribute("datetime");
    if (raw) {
      const c = mkCandidate(raw, "time-tag");
      if (c) out.push(c);
    }
  }
  return out;
}

