// lib/sourceProbe/types.ts
export type ProbeRequest = {
  url: string;
  windowHours?: number; // for future use
};

export type ProbeArticle = {
  title: string;
  url: string;
  author?: string | null;
  publishedAt?: string | null; // ISO
  imageUrl?: string | null;
  sourceHost: string;
};

export type ProbeMethod = "rss" | "scrape" | "adapter";

export type FeedCandidate = {
  feedUrl: string;
  ok: boolean;
  itemCount: number;
  sampleTitles: string[];
  error?: string | null;
};

export type ScrapeCandidate = {
  homepageUrl: string;
  selectorTried: string;
  ok: boolean;
  linkCount: number;
  sampleUrls: string[];
  sampleTitles: string[];
  error?: string | null;
};

export type AdapterCandidate = {
  key: string; // e.g. "espn"
  ok: boolean;
  itemCount: number;
  sampleTitles: string[];
  error?: string | null;
  label?: string;
};

export type ProbeResult = {
  baseUrl: string;
  feeds: FeedCandidate[];
  scrapes: ScrapeCandidate[];
  adapters: AdapterCandidate[];
  preview: ProbeArticle[]; // deduped + normalized
  recommended: Recommendation;
};


// add this new type
export type Recommendation = {
  method: ProbeMethod;
  rationale: string;
  suggestedUrl?: string | null; // if we think a different page is better to save
  selector?: string | null;     // for scrape
  feedUrl?: string | null;      // for rss
};