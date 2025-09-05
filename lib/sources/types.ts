// lib/sources/types.ts

export type ExistingSourceLite = {
  id: number;
  name: string | null;
  homepage_url: string | null;
  rss_url: string | null;
  sitemap_url: string | null;
  scrape_selector: string | null;
  scrape_path: string | null;
  adapter_config: Record<string, unknown> | null;
};

export type CommitPayload = {
  url: string;
  method: ProbeMethod;
  feedUrl?: string | null;
  selector?: string | null;
  adapterKey?: string | null;
  nameHint?: string | null;
  sourceId?: number;     // when updating an existing source
  upsert?: boolean;      // allow update if a match is found
  updates?: {
    name?: string;
    homepage_url?: string | null;
    rss_url?: string | null;
    sitemap_url?: string | null;
    scrape_selector?: string | null;
    scrape_path?: string | null;
    adapter_config?: Record<string, unknown> | null;
    allowed?: boolean | null;
    paywall?: boolean | null;
    category?: string | null;
    sport?: string | null;
    priority?: number | null;
  };
};


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

export type ExistingSource = {
  id: number;
  name: string | null;
  homepage_url: string | null;
  rss_url: string | null;
  sitemap_url: string | null;
  scrape_selector: string | null;
  scrape_path: string | null;
  adapter_config: Record<string, unknown> | null; // jsonb
};

export type ProbeResult = {
  baseUrl: string;
  feeds: FeedCandidate[];
  scrapes: ScrapeCandidate[];
  adapters: AdapterCandidate[];
  preview: ProbeArticle[]; // deduped + normalized
  recommended: Recommendation;
  existingSource?: ExistingSource | null;
};


// add this new type
export type Recommendation = {
  method: ProbeMethod;
  rationale: string;
  suggestedUrl?: string | null; // if we think a different page is better to save
  selector?: string | null;     // for scrape
  feedUrl?: string | null;      // for rss
};


export type ScrapedItem = {
  url: string;                 // absolute
  title: string;
  description?: string;
  imageUrl?: string;
  author?: string;
  publishedAt?: string;        // ISO
};

export interface SourceAdapter {
  /** Return absolute article URLs (with optional lightweight titles/authors) discovered from index pages. */
  getIndex(pageCount?: number): Promise<Array<{ url: string; title?: string; author?: string }>>;

  /** Load one article page and return enriched metadata (OG tags, JSON-LD, byline, etc.). */
  getArticle(url: string): Promise<ScrapedItem>;
}


export type FeedItem = {
  title: string;
  link: string;
  author?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  publishedAt?: Date | null;
  source_id?: number | null;
};




export type SourceConfig = {
  id: number;
  homepage_url: string | null;
  rss_url: string | null;
  sitemap_url: string | null;
  scrape_selector: string | null;
  adapter: string | null;
  fetch_mode: "auto" | "rss" | "sitemap" | "html" | null; // keep 'html' for future
};