// lib/sources/types.ts

export type AdapterEndpoint = {
  kind: "page" | "sitemap";
  url: string;
  selector?: string | null;
};

export type ExistingSourceLite = {
  id: number;
  name: string | null;
  homepage_url: string | null;
  rss_url: string | null;
  sitemap_url: string | null;
  scrape_selector: string | null;
  scrape_path: string | null;
  /** present in queries like findExistingSourceByUrl */
  adapter?: string | null;
  adapter_config: Record<string, unknown> | null;
};

export type CommitPayload = {
  url: string;
  method: ProbeMethod;
  feedUrl?: string | null;
  selector?: string | null;
  adapterKey?: string | null;
  nameHint?: string | null;
  sourceId?: number;      // when updating an existing source
  upsert?: boolean;       // allow update if a match is found
  updates?: SourceUpdates;
};

export type AdapterKey =
  | "sitemap-generic"
  | "fantasylife"
  | "wordpress-generic"
  | "jsonld-list"
  | "next-data"
  | string;

export type MethodPreview = {
  method: "rss" | "scrape" | "adapter";
  items: Array<{ title: string; url: string }>;
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
  key: string;
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
  provider?: string | null;
};

export type ProbeResult = {
  baseUrl: string;
  feeds: FeedCandidate[];
  scrapes: ScrapeCandidate[];
  adapters: AdapterCandidate[];
  preview: Array<{ title: string; url: string }>;
  recommended: {
    method: ProbeMethod;
    rationale: string;
    suggestedUrl?: string | null;
    selector?: string | null;
    feedUrl?: string | null;
  };
  existingSource?: ExistingSource | null;
  previewsByMethod?: Array<{
    method: ProbeMethod;
    items: Array<{ title: string; url: string }>;
  }>;
};

// Optional helper if you surface a recommendation to the UI directly
export type Recommendation = {
  method: ProbeMethod;
  rationale: string;
  suggestedUrl?: string | null;
  selector?: string | null;
  feedUrl?: string | null;
  adapterKey?: string | null;
  endpointKind?: "page" | "sitemap" | null;
};

export type ScrapedItem = {
  url: string;
  title: string;
  description?: string;
  imageUrl?: string;
  author?: string;
  publishedAt?: string;        // ISO
};

export interface SourceAdapter {
  getIndex(pageCount?: number): Promise<Array<{ url: string; title?: string; author?: string }>>;
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
  provider?: string | null;
};

export type SourceConfig = {
  id: number;
  homepage_url: string | null;
  rss_url: string | null;
  sitemap_url: string | null;
  scrape_selector: string | null;
  adapter: string | null;
  fetch_mode: "auto" | "rss" | "adapter" | "scrape" | null;
  provider?: string | null;
};

export type ProbeMethod = "rss" | "scrape" | "adapter";
export type FetchMode = "rss" | "scrape" | "adapter" | "auto";

export interface SourceUpdates {
  // core meta
  name?: string;
  category?: string;
  sport?: string;
  allowed?: boolean;
  paywall?: boolean;
  priority?: number;

  // urls
  homepage_url?: string | null;

  // mutually-exclusive fetch-mode + required columns
  fetch_mode?: FetchMode | null;

  // RSS mode
  rss_url?: string | null;

  // Scrape mode
  scrape_selector?: string | null;

  // Adapter mode
  adapter?: string | null;
  adapter_endpoint?: AdapterEndpoint | null;      // <-- FIX: object not string
  adapter_config?: Record<string, unknown> | null; // <-- FIX: allow null

  // If you keep sitemap separate (used by sitemap adapter)
  sitemap_url?: string | null;
}
