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
