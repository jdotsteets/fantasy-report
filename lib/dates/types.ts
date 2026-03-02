// lib/dates/types.ts
export type PublishedSource =
  | "rss"
  | "atom"
  | "dc"
  | "jsonld"
  | "og"
  | "meta"
  | "time-tag"
  | "url"
  | "sitemap"
  | "modified"
  | "text"        // visible "Published ..." label
  | "relative"; 

export type DateCandidate = {
  iso: string;              // normalized ISO-8601 in UTC
  raw: string;              // original raw value
  source: PublishedSource;  // where we found it
  confidence: number;       // 0..100
  tz?: string | null;       // e.g., 'America/New_York'
};
