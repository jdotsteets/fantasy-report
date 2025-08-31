// lib/sources/types.ts
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
