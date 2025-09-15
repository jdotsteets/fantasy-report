// lib/dates/resolvePublished.ts
import type { DateCandidate } from "./types";
import { extractFromFeed } from "./feedExtractors";
import { extractFromJsonLD, extractFromMeta, extractFromTimeTag } from "./htmlExtractors";
import { extractFromUrl, pickBest } from "./parse";

export type ResolveInputs = {
  url: string;
    html?: string | null;

  feedEntry?: import("./feedExtractors").FeedLike | null;
  htmlDoc?: Document | null; // if you fetched the page
  sitemapLastmod?: string | null;
};

export type ResolvedPublished = {
  published_at?: string | null;
  published_raw?: string | null;
  published_source?: string | null;
  published_confidence?: number | null;
  published_tz?: string | null;
};

export function resolvePublished(inputs: ResolveInputs): ResolvedPublished {
  const cands: DateCandidate[] = [];
  const { url, feedEntry, htmlDoc, sitemapLastmod } = inputs;

  const urlCand = extractFromUrl(url);
  if (urlCand) cands.push(urlCand);

  if (feedEntry) cands.push(...extractFromFeed(feedEntry));
  if (htmlDoc) {
    cands.push(...extractFromJsonLD(htmlDoc));
    cands.push(...extractFromMeta(htmlDoc));
    cands.push(...extractFromTimeTag(htmlDoc));
  }
  if (sitemapLastmod && sitemapLastmod.trim() !== "") {
    const siteCand = { ...urlCand, iso: sitemapLastmod, raw: sitemapLastmod, source: "sitemap" as const, confidence: 50 };
    if (siteCand.iso) cands.push(siteCand);
  }

  const best = pickBest(cands);
  if (!best) return {};
  return {
    published_at: best.iso,
    published_raw: best.raw,
    published_source: best.source,
    published_confidence: best.confidence,
    published_tz: best.tz ?? null,
  };
}
