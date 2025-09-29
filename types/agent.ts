// types/agent.ts
export type BriefStatus = "draft" | "published" | "archived";

export type GenerateBriefInput = {
  article_id: number;
  autopublish?: boolean; // default false (draft)
};

export type WriterJSON = {
  brief: string; // ≤ 75 words
  why_matters: string[]; // 1–2 items, ≤ ~22 words each
  seo: { title: string; meta_description: string };
  cta_label: string; // e.g., "Read the full article at ESPN →"
  tone: "neutral-informative";
};

export type GenerateBriefResult = {
  created_brief_id: number;
  slug: string;
  status: BriefStatus;
  scores: {
    brevity_ok: boolean;
    originality: number;   // 0..1
    groundedness_ok: boolean;
  };
};
