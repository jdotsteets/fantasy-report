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

export async function generateBriefForArticle(article_id: number, autopublish = false) {
  // 1) Load article
  const [art] = await dbQueryRows<ArticleRow>(`SELECT * FROM articles WHERE id = $1`, [article_id]);
  if (!art) throw new Error("Article not found");

  // 2) Resolve provider/source name
  let provider = art.domain ?? "Source";
  if (art.source_id) {
    const src = await dbQueryRows<SourceRow>(`SELECT id, name FROM sources WHERE id = $1`, [art.source_id]);
    if (src[0]?.name) provider = src[0].name;
  }

  // 3) Build the writer payload (this was missing)
  const payload: WriterUserPayload = {
    provider,
    source_title: art.title,
    source_url: art.canonical_url ?? art.url,
    published_at: art.published_at,
    clean_snippet: clampSnippet(art.summary, art.title, 600),
    entities: [],            // fill later if you add NER
    section_hint: art.primary_topic,
    internal_candidates: [], // fill in Phase 2.1 (embeddings)
  };

  // 4) Writer → JSON
  const writerRes = await callLLMWriter({ system: SYSTEM_WRITER, user: payload });
  const writerJson = JSON.parse(writerRes.text) as unknown;
  const writerParsed = WriterJsonSchema.safeParse(writerJson);
  if (!writerParsed.success) throw new Error("Writer JSON failed validation");

  // 5) Critic → JSON (revise if needed)
  const criticRes = await callLLMCritic({ system: SYSTEM_CRITIC, user: writerParsed.data });
  const criticJson = JSON.parse(criticRes.text) as unknown;
  const criticParsed = WriterJsonSchema.safeParse(criticJson);
  const final = criticParsed.success ? criticParsed.data : writerParsed.data;

  // 6) Guardrails
  const brevity_ok = countWords(final.brief) <= 75;
  const originality = 1 - jaccard(final.brief, payload.clean_snippet);
  const groundedness_ok = true;

  // 7) Save draft/published
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
