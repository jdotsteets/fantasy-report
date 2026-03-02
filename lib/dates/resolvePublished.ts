import type { DateCandidate } from "./types";
import type { FeedLike } from "./feedExtractors";
import { extractFromFeed } from "./feedExtractors";
import { extractFromJsonLD, extractFromMeta, extractFromTimeTag, loadHtml,
         extractFromPublishedLabel, extractFromRelativeAgo } from "./htmlExtractors";
import { extractFromUrl, pickBest } from "./parse";

export type ResolveInputs = {
  url: string;
  feedEntry?: FeedLike | null;
  html?: string | null;           // server-friendly path
  htmlDoc?: Document | null;      // legacy path (optional)
  sitemapLastmod?: string | null;
  nowIso?: string | null;         // for “x hours ago” math
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
  const { url, feedEntry, html, htmlDoc, sitemapLastmod, nowIso } = inputs;

  const urlCand = extractFromUrl(url);
  if (urlCand) cands.push(urlCand);

  if (feedEntry) cands.push(...extractFromFeed(feedEntry));

  const htmlStr: string | null =
    (html && html.trim() !== "" ? html : null) ??
    (() => htmlDoc?.documentElement?.outerHTML ?? null)();

  if (htmlStr) {
    const $ = loadHtml(htmlStr);
    cands.push(...extractFromJsonLD($));
    cands.push(...extractFromMeta($));
    cands.push(...extractFromTimeTag($));
    cands.push(...extractFromPublishedLabel($));     // NEW
    cands.push(...extractFromRelativeAgo($, nowIso)); // NEW
  }

  if (sitemapLastmod && sitemapLastmod.trim() !== "") {
    cands.push({
      iso: sitemapLastmod,
      raw: sitemapLastmod,
      source: "sitemap",
      confidence: 50,
      tz: null,
    });
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
