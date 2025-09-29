// lib/agent/prompts.ts

/** Writer system prompt
 *  Notes:
 *  - Must contain the word "json" somewhere when using response_format: { type: "json_object" }.
 *  - We explicitly require STRICT JSON output with the exact keys.
 */
export const SYSTEM_WRITER = [
  // ✅ Explicit json requirement for the API
  "Respond ONLY in strict json. No prose, no markdown, no backticks.",
  "You are an editor for The Fantasy Report.",
  "Write ORIGINAL, concise briefs that add value beyond the source.",
  "No copying; no quotes longer than 10 words.",
  "Brief must be ≤ 75 words total.",
  "Provide 1–2 'Why it matters' bullets with actionable fantasy implications.",
  "Neutral, fact-anchored tone. No speculation.",
  // ✅ Exact schema reminder
  "Output json with EXACT keys: ",
  "{",
  '  "brief": string,',
  '  "why_matters": string[],',
  '  "seo": { "title": string, "meta_description": string },',
  '  "cta_label": string,',
  '  "tone": "neutral-informative"',
  "}",
  "No extra keys. No nulls: use empty string \"\" or [] if something is missing.",

  "",
  "Style for 'Why it matters' bullets:",
  "• No emojis, hashtags, cliches, or generic advice.",
  "• Be specific: usage, routes, targets, snaps, touches, red-zone, scheme, matchup (CB/coverage, DVOA), role change, injury impact.",
  "• Prefer one concrete detail + one actionable takeaway.",
  "• 6–18 words each.",
  "• Start with an action or metric (e.g., 'Routes up 18%' / 'Start as WR2').",
].join(" ");

/** Critic/repair system prompt
 *  Also mentions json explicitly so it’s valid with json_object formatting.
 */
export const SYSTEM_CRITIC = [
  "You validate or repair the candidate json. Return STRICT json only.",
  "Rules:",
  "• Brief ≤ 75 words.",
  "• why_matters has 1–2 bullets; each 6–18 words; specific + actionable.",
  "• All claims must be supported by the provided inputs; no invented stats; neutral tone.",
  "Schema (exact keys only): ",
  "{",
  '  "brief": string,',
  '  "why_matters": string[],',
  '  "seo": { "title": string, "meta_description": string },',
  '  "cta_label": string,',
  '  "tone": "neutral-informative"',
  "}",
  "No extra keys. If a value is missing, use empty string \"\" or [].",
  "Return json ONLY (same shape).",
].join(" ");

export type WriterUserPayload = {
  provider: string;
  source_title: string;
  source_url: string;
  published_at: string | null;
  clean_snippet: string; // 80–600 chars of safe excerpt or the title
  entities: string[];
  section_hint: string | null; // 'dfs' | 'start-sit' | 'waivers' | 'news' | etc.
  internal_candidates: Array<{ title: string; url: string; similarity: number }>;
};

export function clampSnippet(s: string | null, fallback: string, max = 600): string {
  const base = (s ?? "").trim();
  if (base.length >= 80) return base.slice(0, max);
  return fallback.slice(0, max);
}

// Optional few-shot exemplars the model sees as part of user payload
export const BULLET_EXAMPLES = {
  "start-sit": [
    "Routes up 16% last week; viable WR3 vs zone-heavy DET.",
    "If limited Thursday, downgrade to flex only in 12-teamers.",
  ],
  dfs: [
    "Slot rate 64% vs Cover-3; leverage play at sub-10% proj ownership.",
    "Red-zone targets lead team; viable bring-back at mid-tier salary.",
  ],
  waivers: [
    "Lead back on early downs; bid 8–12% FAAB if RB-needy.",
    "Routes jumped post-bye; priority add in 12-team PPR.",
  ],
  news: [
    "Hamstring limits deep routes; expect more underneath usage.",
    "Snap share capped near 60% in first game back.",
  ],
} as const;
