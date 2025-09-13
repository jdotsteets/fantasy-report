export type UpsertResult =
  | { inserted: true; updated?: false }
  | { updated: true; inserted?: false };

export type ArticleInput = {
  canonical_url?: string | null;
  url?: string | null;
  link?: string | null;
  source_id?: number | null;
  sourceId?: number | null;
  title?: string | null;
  author?: string | null;
  published_at?: string | Date | null;
  publishedAt?: string | Date | null;
  image_url?: string | null;
  domain?: string | null;
  sport?: string | null;
  topics?: string[] | null;
  primary_topic?: string | null;
  secondary_topic?: string | null;
  week?: number | null;
  players?: string[] | null;
  is_player_page?: boolean | null;
};

export type SourceRow = {
  id: number;
  name: string | null;
  allowed: boolean | null;
  rss_url?: string | null;
  homepage_url?: string | null;
  scrape_selector?: string | null;
};

export type IngestSummary = { total: number; inserted: number; updated: number; skipped: number };

export type JobEventLevel = "info" | "warn" | "error" | "debug";

export type IngestDecision = { kind: "article" | "index" | "skip"; reason?: string; section?: string };

export type Adapters = {
  extractCanonicalUrl?: (url: string, html?: string) => Promise<string | null>;
  scrapeArticle?: (url: string) => Promise<
    Partial<ArticleInput> & {
      canonical_url?: string | null;
      summary?: string | null;
      author?: string | null;
      image_url?: string | null;
      url?: string | null;
      published_at?: Date | string | null;
    }
  >;
  routeByUrl?: (url: string) => Promise<IngestDecision>;
};
