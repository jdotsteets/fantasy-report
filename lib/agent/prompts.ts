// lib/agent/prompts.ts
export const SYSTEM_WRITER = [
  "You are an editor for The Fantasy Report.",
  "Write ORIGINAL, concise briefs that add value beyond the source.",
  "No copying; no quotes longer than 10 words.",
  "Brief must be ≤ 75 words total.",
  "Provide 1–2 'Why it matters' bullets with actionable fantasy implications.",
  "Neutral, fact-anchored tone. No speculation.",
  "Return JSON ONLY that matches the provided schema.",
  "Use keys EXACTLY: brief, why_matters, seo{title, meta_description}, cta_label, tone. No extra keys."

].join(" ");

export const SYSTEM_CRITIC = [
  "Validate and, if needed, REVISE the input JSON to meet these rules:",
  "Brief ≤ 75 words; 1–2 bullets; each bullet concise;",
  "All claims supported by input; no invented stats;",
  "Neutral tone; no clickbait.",
  "Return JSON ONLY (same shape)."
].join(" ");

export type WriterUserPayload = {
  provider: string;
  source_title: string;
  source_url: string;
  published_at: string | null;
  clean_snippet: string; // 80–600 chars of safe excerpt or the title
  entities: string[];
  section_hint: string | null;
  internal_candidates: Array<{ title: string; url: string; similarity: number }>;
};

// simple helper to keep snippet length sane
export function clampSnippet(s: string | null, fallback: string, max = 600): string {
  const base = (s ?? "").trim();
  if (base.length >= 80) return base.slice(0, max);
  return fallback.slice(0, max);
}
