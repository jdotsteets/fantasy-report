// /types/sources.ts

export type TopicKey =
  | "waiver-wire"
  | "rankings"
  | "start-sit"
  | "injury"
  | "dfs"
  | "news"
  | "advice";


export type SourceRow = {
  id: number;
  name: string | null;
  homepage_url: string | null;
  rss_url: string | null;
  sitemap_url: string | null;
  favicon_url: string | null;
  allowed: boolean | null;
  priority: number | null;
  created_at: string | null;
  category: string | null;
  sport: string | null;
  notes: string | null;
  scrape_path: string | null;
  scrape_selector: string | null;
  paywall: boolean | null;
  scraper_key?: string | null; // explicit adapter key (legacy map)
  adapter_config?: Record<string, unknown> | null; // may include { adapter?: string, pageCount?, daysBack?, limit?, headers? }
  fetch_mode?: "auto" | "rss" | "adapter" | null;
};

// 
export type SearchResult = {
  id: number;
  title: string;
  url: string;
  canonical_url: string | null;
  domain: string | null;
  published_at: string | null;
  source: string;
  rank: number;
  headline: string; // HTML with <mark> tags
};



export type Enriched = {
  url?: string;
  canonical_url?: string | null;
  domain?: string | null;
  cleaned_title?: string | null;
  slug?: string | null;
  fingerprint?: string | null;
  published_at?: string | null;
  week?: number | null;
  topics?: string[] | null;
  image_url?: string | null;
};




// /types.sources.ts
export type Article = {
  id: number;
  source_id?: number | null;
  title: string;
  url: string;
  author?: string | null;
  canonical_url: string | null;
  domain: string | null;
  published_at: string | null;
  source: string | null;
  image_url?: string | null;
  discovered_at?: string | null;
  summary?: string | null;
  topics?: readonly string[] | null;
  players?: [];
  sport?: string | null;
  Article?: string | null;
  season?: number | null;
  week?: number | null;
  score?: number | null;
  slug?: string | null;
  fingerprint?: string | null;
  cleaned_title?: string | null;
  popularity_score?: number | null;
  popularity?: number | null;
  image_source?: string | null;
  image_checked_at?: string | null;
  primary_topic?: string | null;
  is_player_page?: boolean | null;
  secondary_topic?: string | null;
  is_static?: boolean | null;
  static_type?: string | null;

};
