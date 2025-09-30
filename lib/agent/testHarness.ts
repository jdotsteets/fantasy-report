// lib/agent/testHarness.ts
import {
  SYSTEM_WRITER,
  SYSTEM_CRITIC,
  clampSnippet,
  type WriterUserPayload,
} from "./prompts";
import { WriterJsonSchema } from "@/lib/zodAgent";
import { dbQueryRows } from "@/lib/db";
import { callLLMWriter, callLLMCritic } from "./llm";
import { normalizeWriterShape, rewriteBulletsIfWeak } from "./generateBrief"; // make sure these are exported


async function repairWithCritic(
  candidate: unknown,
  zodErrors: unknown
): Promise<unknown> {
  const res = await callLLMCritic({
    system: SYSTEM_CRITIC,
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

export async function testBriefDryRun(args: {
  article_id: number;
  temperature?: number;
  model?: string;
}) {
  const { article_id, temperature = 0.2, model = process.env.OPENAI_MODEL } = args;

  const [art] = await dbQueryRows<ArticleRow>(
    `SELECT * FROM articles WHERE id=$1`,
    [article_id]
  );
  if (!art) {
    return { error: "Article not found", article_id };
  }

  let provider = art.domain ?? "Source";
  if (art.source_id) {
    const src = await dbQueryRows<SourceRow>(
      `SELECT id, name FROM sources WHERE id = $1`,
      [art.source_id]
    );
    if (src[0]?.name) provider = src[0].name!;
  }

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

  const writerRes = await callLLMWriter({
    system: SYSTEM_WRITER,
    user: payload,
    model,
  });

  const raw = writerRes.text;
  let normalized: any = null;
  let parseErrors: string | null = null;

  try {
    normalized = normalizeWriterShape(JSON.parse(raw));
  } catch {
    parseErrors = "JSON parse error";
    normalized = {};
  }

  let validated = WriterJsonSchema.safeParse(normalized);
  let repaired: any = null;

  if (!validated.success) {
    const fixed = await repairWithCritic(normalized, validated.error.flatten());
    const fixedNorm = normalizeWriterShape(fixed);
    const again = WriterJsonSchema.safeParse(fixedNorm);
    if (again.success) {
      repaired = again.data;
      validated = again;
    }
  }

  const brief = validated.success ? validated.data : null;

  return {
    ok: validated.success,
    article_id,
    prompts: {
      SYSTEM_WRITER,
      SYSTEM_CRITIC,
      model,
      temperature,
    },
    payload,
    raw,
    normalized,
    parseErrors,
    repaired,
    brief,
  };
}


type GenerateBriefDryRunArgs = {
  article_id: number;
  writerFn?: typeof callLLMWriter;
  criticFn?: typeof callLLMCritic;
  temperature?: number;
};

export async function generateBriefDryRun({
  article_id,
  writerFn = callLLMWriter,
  criticFn = callLLMCritic,
  temperature = 0.2,
}: GenerateBriefDryRunArgs) {
  const [art] = await dbQueryRows<any>(`SELECT * FROM articles WHERE id=$1`, [article_id]);
  if (!art) throw new Error("Article not found");

  const provider = art.domain ?? "Source";
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

  const writerRes = await writerFn({
    system: SYSTEM_WRITER,
    user: payload,
    model: process.env.OPENAI_MODEL,
  });

  let raw = writerRes.text;
  let normalized: any;
  let parseErrors: string | null = null;

  try {
    normalized = normalizeWriterShape(JSON.parse(raw));
  } catch {
    parseErrors = "JSON parse error";
    normalized = {};
  }

  let validated = WriterJsonSchema.safeParse(normalized);
  let repaired: any = null;

  if (!validated.success) {
    const rep = await criticFn({
      system: SYSTEM_CRITIC,
      user: {
        candidate: normalized,
        zod_errors: validated.error.flatten(),
      },
    });
    repaired = JSON.parse(rep.text);
    validated = WriterJsonSchema.safeParse(repaired);
  }

  const final = validated.success ? validated.data : null;
  const bullets =
    final &&
    (await rewriteBulletsIfWeak(final.why_matters, {
      section_hint: payload.section_hint,
      payload,
      brief: final.brief,
    }));

  return {
    payload,
    raw_writer_text: raw,
    normalized,
    parseErrors,
    repaired,
    validation_ok: validated.success,
    zod_issues: validated.success ? null : validated.error.flatten(),
    final_preview: final
      ? { brief: final.brief, bullets, seo: final.seo }
      : null,
  };
}
