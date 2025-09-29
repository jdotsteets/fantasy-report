import { SYSTEM_WRITER, SYSTEM_CRITIC, clampSnippet, type WriterUserPayload } from "./prompts";
import { WriterJsonSchema } from "@/lib/zodAgent";
import { dbQueryRows } from "@/lib/db";
import { callLLMWriter, callLLMCritic } from "./llm";
import { normalizeWriterShape, rewriteBulletsIfWeak } from "./generateBrief"; // make sure these are exported

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
