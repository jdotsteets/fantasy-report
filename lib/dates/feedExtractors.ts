// lib/dates/feedExtractors.ts
import type { DateCandidate } from "./types";
import { mkCandidate } from "./parse";

export type FeedLike = {
  pubDate?: string | null;
  published?: string | null;
  updated?: string | null;
  ["dc:date"]?: string | null;
};

export function extractFromFeed(entry: FeedLike): DateCandidate[] {
  const out: DateCandidate[] = [];
  const pairs: Array<[string | null | undefined, "rss" | "atom" | "dc" | "modified"]> = [
    [entry.pubDate, "rss"],
    [entry.published, "atom"],
    [entry["dc:date"], "dc"],
    [entry.updated, "modified"],
  ];
  for (const [raw, src] of pairs) {
    if (typeof raw === "string" && raw.trim() !== "") {
      const c = mkCandidate(raw, src);
      if (c) out.push(c);
    }
  }
  return out;
}
