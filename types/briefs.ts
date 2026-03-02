// types/briefs.ts
export type BriefStatus = "draft" | "published" | "archived";

export type Brief = {
  id: number;
  article_id: number;
  slug: string;
  summary: string;
  why_matters: string[];         // jsonb -> string[]
  seo_title: string | null;
  seo_description: string | null;
  status: BriefStatus;
  scores: Record<string, unknown>;
  created_at: string;            // ISO
  updated_at: string;            // ISO
  published_at: string | null;   // ISO
};

export type BriefWithArticle = Brief & {
  article_title: string;
  article_url: string;
  article_domain: string | null;
  article_image_url: string | null;
  article_published_at: string | null;
  source_name: string | null;
};
