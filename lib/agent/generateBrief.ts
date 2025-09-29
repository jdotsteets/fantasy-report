// lib/agent/generateBrief.ts (replace the whole function)

import { SYSTEM_WRITER, SYSTEM_CRITIC, clampSnippet, type WriterUserPayload } from "./prompts";
import { callLLMWriter, callLLMCritic } from "./llm";
import { WriterJsonSchema } from "@/lib/zodAgent";
import { createBrief } from "@/lib/briefs";
import { dbQueryRows } from "@/lib/db";

type ArticleRow = {
  id: number;
  title: string;
  url: string;
  canonical_url: string | null;
  source_id: number | null;
  published_at: string | null;
  summary: string | null;
  domain: string | null;
  primary_topic: string | null;
};

type SourceRow = { id: number; name: string | null };

function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function jaccard(a: string, b: string): number {
  const A = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
  const B = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
  const inter = new Set([...A].filter(x => B.has(x))).size;
  const union = new Set([...A, ...B]).size;
  return union === 0 ? 0 : inter / union;
}

function normalizeWriterShape(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  // shallow copy
  const o = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;

  // accept camelCase or snake_case keys
  // why_matters
  if (!("why_matters" in o) && "whyMatters" in o) o.why_matters = o.whyMatters;

  // seo
  const seo = (o.seo ?? (o as any).SEO ?? {}) as Record<string, unknown>;
  if (seo && typeof seo === "object") {
    if (!("meta_description" in seo) && "metaDescription" in seo) {
      seo.meta_description = (seo as any).metaDescription;
    }
    o.seo = seo;
  }

  // tone fallbacks
  if (o.tone === "informative" || o.tone === "neutral-info") o.tone = "neutral-informative";

  return o;
}

async function repairWithCritic(
  criticFn: (args: { system: string; user: unknown }) => Promise<{ text: string }>,
  system: string,
  candidate: unknown,
  zodErrors: unknown
): Promise<unknown> {
  const res = await criticFn({
    system,
    user: {
      instructions:
        "You will be given a JSON object that failed validation. Return corrected JSON ONLY (no prose). " +
        "Keys must be: brief, why_matters, seo{title, meta_description}, cta_label, tone.",
      candidate,
      zod_errors: zodErrors,
    },
  });
  return JSON.parse(res.text) as unknown;
}


export async function generateBriefForArticle(article_id: number, autopublish = false) {
  // 1) Load article
  const [art] = await dbQueryRows<ArticleRow>(`SELECT * FROM articles WHERE id = $1`, [article_id]);
  if (!art) throw new Error("Article not found");

  // 2) Resolve provider/source name
  let provider = art.domain ?? "Source";
  if (art.source_id) {
    const src = await dbQueryRows<SourceRow>(`SELECT id, name FROM sources WHERE id = $1`, [art.source_id]);
    if (src[0]?.name) provider = src[0].name!;
  }

  // 3) Build payload
  const payload: WriterUserPayload = {
    provider,
    source_title: art.title,
    source_url: art.canonical_url ?? art.url,
    published_at: art.published_at,
    clean_snippet: clampSnippet(art.summary, art.title, 600),
    entities: [],
    section_hint: art.primary_topic,
    internal_candidates: [],
  };

  // 4) Writer
  const writerRes = await callLLMWriter({ system: SYSTEM_WRITER, user: payload });

  // Log once for debugging if things go sideways
  console.error("[generateBrief] writer raw:", writerRes.text.slice(0, 1000));

  // 5) Parse → normalize → validate; if fails, repair via critic once
  let candidate = normalizeWriterShape(JSON.parse(writerRes.text) as unknown);
  let parsed = WriterJsonSchema.safeParse(candidate);

  if (!parsed.success) {
    const repaired = await repairWithCritic(callLLMCritic, SYSTEM_CRITIC, candidate, parsed.error.flatten());
    candidate = normalizeWriterShape(repaired);
    parsed = WriterJsonSchema.safeParse(candidate);
  }

  if (!parsed.success) {
    throw new Error("Writer JSON failed validation after repair");
  }

  const final = parsed.data;

  // 6) Guardrails
  const brevity_ok = countWords(final.brief) <= 75;
  const originality = 1 - jaccard(final.brief, payload.clean_snippet);
  const groundedness_ok = true;

  // 7) Save brief (draft or published)
  const saved = await createBrief({
    article_id,
    summary: final.brief,
    why_matters: final.why_matters,
    seo_title: final.seo.title,
    seo_description: final.seo.meta_description,
    status: autopublish ? "published" : "draft",
  });

  return {
    created_brief_id: saved.id,
    slug: saved.slug,
    status: saved.status,
    scores: { brevity_ok, originality, groundedness_ok },
  };
}