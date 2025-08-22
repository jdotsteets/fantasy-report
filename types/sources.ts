// /types/sources.ts
export type SourceRow = {
  id: number;
  name: string;
  homepage_url: string | null;
  rss_url: string | null;
  sitemap_url: string | null;
  favicon_url: string | null;
  allowed: boolean | null;
  priority: number | null;
  created_at: string | null; // ISO string if fetched via pg driver/Next.js
  category: string | null;
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
  title: string;
  url: string;
  canonical_url: string | null;
  domain: string | null;
  published_at: string | null;
  source: string;
  image_url?: string | null;
};
