// lib/agent/llm.ts
type ChatArgs = { system: string; user: unknown; model?: string };

type OpenAIChatChoice = { message?: { content?: string } };
type OpenAIChatResp = { choices?: OpenAIChatChoice[] };

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
const DEFAULT_TEMP = 0.2;

function toJson(obj: unknown): string {
  // Ensures valid JSON string (never throws)
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

async function chatJson(
  { system, user, model }: ChatArgs,
  maxRetries = 4
): Promise<string> {
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
  let delay = 400; // ms

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

    // Retry on 429 and 5xx
    if (res.status === 429 || res.status >= 500) {
      if (attempt > maxRetries) {
        const txt = await res.text().catch(() => "");
        throw new Error(`OpenAI HTTP ${res.status} after ${maxRetries} retries: ${txt}`);
      }
      const retryMs = parseRetryAfterMs(res.headers);
      const wait = retryMs ?? Math.min(5000, delay);
      await sleep(wait + Math.floor(Math.random() * 250)); // jitter
      delay *= 2;
      continue;
    }

    // Non-retryable
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
