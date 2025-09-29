// lib/agent/llm.ts
type ChatArgs = { system: string; user: unknown; model?: string };

function toJson(obj: unknown): string {
  return JSON.stringify(obj);
}

async function chatJson({ system, user, model }: ChatArgs): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  const m = model ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: m,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: toJson(user) },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenAI HTTP ${res.status}: ${text}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = json.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error("Empty LLM response");
  return text;
}

export async function callLLMWriter(payload: ChatArgs): Promise<{ text: string }> {
  return { text: await chatJson(payload) };
}
export async function callLLMCritic(payload: ChatArgs): Promise<{ text: string }> {
  return { text: await chatJson(payload) };
}
