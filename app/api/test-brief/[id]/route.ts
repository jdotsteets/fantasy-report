import { NextRequest, NextResponse } from "next/server";
import { SYSTEM_WRITER, SYSTEM_CRITIC } from "@/lib/agent/prompts";
import { dbQueryRow } from "@/lib/db";
// import your existing LLM runner – adapt the call below to your real function
import { runWriterAndCriticForArticle } from "@/lib/agent/llm";

export const runtime = "nodejs";

type Params = { id: string };

async function articleExists(id: number): Promise<boolean> {
  const row = await dbQueryRow<{ exists: boolean }>(
    "select exists(select 1 from articles where id = $1) as exists",
    [id]
  );
  return Boolean(row?.exists);
}

export async function GET(_req: NextRequest, { params }: { params: Params }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }
  if (!(await articleExists(id))) {
    return NextResponse.json({ ok: false, error: "Article not found" }, { status: 404 });
  }

  const result = await runWriterAndCriticForArticle(id, {
    systemWriter: SYSTEM_WRITER,
    systemCritic: SYSTEM_CRITIC,
  });
  return NextResponse.json(result);
}

export async function POST(req: NextRequest, { params }: { params: Params }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }
  if (!(await articleExists(id))) {
    return NextResponse.json({ ok: false, error: "Article not found" }, { status: 404 });
  }

  type Body = { system_writer?: string; system_critic?: string };
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const systemWriter =
    typeof body.system_writer === "string" && body.system_writer.trim()
      ? body.system_writer
      : SYSTEM_WRITER;

  const systemCritic =
    typeof body.system_critic === "string" && body.system_critic.trim()
      ? body.system_critic
      : SYSTEM_CRITIC;

  const result = await runWriterAndCriticForArticle(id, {
    systemWriter,
    systemCritic,
  });

  return NextResponse.json(result);
}
