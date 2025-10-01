// lib/agent/llm.ts
import { SYSTEM_WRITER, SYSTEM_CRITIC, BULLET_EXAMPLES } from "@/lib/agent/prompts";
import type { WriterUserPayload } from "@/lib/agent/prompts";
import { dbQueryRow } from "@/lib/db";

/* ───────── types ───────── */

type ChatArgs = { system: string; user: unknown; model?: string };

type OpenAIChatChoice = { message?: { content?: string } };
type OpenAIChatResp = { choices?: OpenAIChatChoice[] };

type ArticleRow = {
  id: number;
  title: string;
  url: string | null;
  domain: string | null;
  published_at: string | null; // ISO string
};

type RunOptions = {
  systemWriter?: string;
  systemCritic?: string;
  model?: string;
};

type RunReturn =
  | {
      ok: true;
      article_id: number;
      data: unknown | null; // parsed JSON if possible
      writer_raw: string;
      critic_raw: string;
    }
  | {
      ok: false;
      article_id: number;
      error: string;
      writer_raw?: string;
      critic_raw?: string;
    };

/* ───────── util ───────── */

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
const DEFAULT_TEMP = 0.2;

function toJson(obj: unknown): string {
  try {
    return JSON.stringify(obj);
  } catch {
    return String(obj);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseRetryAfterMs(h: Headers): number | null {
  const ra = h.get("retry-after");
  if (!ra) return null;
  const n = Number(ra);
  return Number.isFinite(n) ? Math.max(0, n * 1000) : null;
}

function safeParseJson<T>(text: string): { ok: true; value: T } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) as T };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown JSON parse error" };
  }
}

function clampSnippetLocal(s: string | null | undefined, fallback: string, max = 600): string {
  const base = (s ?? "").trim();
  if (base.length >= 80) return base.slice(0, max);
  return fallback.slice(0, max);
}

/* ───────── OpenAI caller ───────── */

async function chatJson({ system, user, model }: ChatArgs, maxRetries = 4): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const body = JSON.stringify({
    model: model ?? DEFAULT_MODEL,
    temperature: DEFAULT_TEMP,
    response_format: { type: "json_object" as const },
    messages: [
      { role: "system" as const, content: system },
      { role: "user" as const, content: toJson(user) },
    ],
  });

  let attempt = 0;
  let delay = 400;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt += 1;

    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body,
    });

    if (res.ok) {
      const json = (await res.json()) as OpenAIChatResp;
      const text = json.choices?.[0]?.message?.content ?? "";
      if (!text) throw new Error("Empty LLM response");
      return text;
    }

    if (res.status === 429 || res.status >= 500) {
      if (attempt > maxRetries) {
        const txt = await res.text().catch(() => "");
        throw new Error(`OpenAI HTTP ${res.status} after ${maxRetries} retries: ${txt}`);
      }
      const retryMs = parseRetryAfterMs(res.headers);
      const wait = retryMs ?? Math.min(5000, delay);
      await sleep(wait + Math.floor(Math.random() * 250));
      delay *= 2;
      continue;
    }

    const txt = await res.text().catch(() => "");
    throw new Error(`OpenAI HTTP ${res.status}: ${txt}`);
  }
}

export async function callLLMWriter(payload: ChatArgs): Promise<{ text: string }> {
  return { text: await chatJson(payload) };
}

export async function callLLMCritic(payload: ChatArgs): Promise<{ text: string }> {
  return { text: await chatJson(payload) };
}

/* ───────── DB + payload ───────── */

async function fetchArticleRow(articleId: number): Promise<ArticleRow | null> {
  // MINIMAL columns so it works across schema variations
  const sql = `
    select
      a.id,
      a.title,
      a.url,
      a.domain,
      to_char(a.published_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as published_at
    from articles a
    where a.id = $1
    limit 1
  `;
  const row = await dbQueryRow<ArticleRow>(sql, [articleId]);
  return row ?? null;
}

function buildWriterPayload(row: ArticleRow): WriterUserPayload {
  const provider = (row.domain ?? "unknown").trim();
  const publishedIso = row.published_at && row.published_at.length > 0 ? row.published_at : null;

  return {
    provider,
    source_title: row.title,
    source_url: row.url ?? "",
    published_at: publishedIso,
    // We’re not selecting snippet fields – use title as a safe fallback
    clean_snippet: clampSnippetLocal(null, row.title),
    entities: [],
    section_hint: null,
    internal_candidates: [],
  };
}

/* ───────── main runner ───────── */

export async function runWriterAndCriticForArticle(
  articleId: number,
  { systemWriter, systemCritic, model }: RunOptions = {}
): Promise<RunReturn> {
  if (!Number.isFinite(articleId) || articleId <= 0) {
    return { ok: false, article_id: articleId, error: "Invalid articleId" };
  }

  const row = await fetchArticleRow(articleId);
  if (!row) {
    return { ok: false, article_id: articleId, error: "Article not found" };
  }

  const payload = buildWriterPayload(row);

  const writerSystem = systemWriter && systemWriter.trim().length > 0 ? systemWriter : SYSTEM_WRITER;
  const criticSystem = systemCritic && systemCritic.trim().length > 0 ? systemCritic : SYSTEM_CRITIC;

  // Writer pass
  const writerUser = { payload, examples: BULLET_EXAMPLES };
  const writer = await callLLMWriter({ system: writerSystem, user: writerUser, model });

  // Critic/repair pass
  const criticUser = {
    candidate: writer.text,
    inputs: payload,
    rules: "Validate or repair to match the exact schema and constraints.",
  };
  const critic = await callLLMCritic({ system: criticSystem, user: criticUser, model });

  // Prefer critic JSON, then writer JSON, else return raw
  const parsedCritic = safeParseJson<unknown>(critic.text);
  if (parsedCritic.ok) {
    return { ok: true, article_id: articleId, data: parsedCritic.value, writer_raw: writer.text, critic_raw: critic.text };
  }
  const parsedWriter = safeParseJson<unknown>(writer.text);
  if (parsedWriter.ok) {
    return { ok: true, article_id: articleId, data: parsedWriter.value, writer_raw: writer.text, critic_raw: critic.text };
  }

  return {
    ok: false,
    article_id: articleId,
    error: `Failed to parse JSON: critic="${parsedCritic.error}" writer="${parsedWriter.error}"`,
    writer_raw: writer.text,
    critic_raw: critic.text,
  };
}
