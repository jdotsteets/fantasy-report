// app/api/test-brief/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { SYSTEM_WRITER, SYSTEM_CRITIC } from "@/lib/agent/prompts";
import { dbQueryRow } from "@/lib/db";
import { runWriterAndCriticForArticle } from "@/lib/agent/llm";

export const runtime = "nodejs";

/* ───────────── helpers ───────────── */

function extractId(req: NextRequest): number | null {
  // Robustly grab the last non-empty path segment as the id
  const { pathname } = new URL(req.url);
  const clean = pathname.replace(/\/+$/, "");
  const last = clean.split("/").pop();
  const n = Number(last);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function articleExists(id: number): Promise<boolean> {
  const row = await dbQueryRow<{ exists: boolean }>(
    "select exists(select 1 from articles where id = $1) as exists",
    [id]
  );
  return Boolean(row?.exists);
}

/* ───────────── GET: run with defaults ───────────── */

export async function GET(req: NextRequest) {
  const id = extractId(req);
  if (!id) {
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

/* ───────────── POST: allow prompt overrides ───────────── */

type Body = {
  system_writer?: string;
  system_critic?: string;
  model?: string;
};

export async function POST(req: NextRequest) {
  const id = extractId(req);
  if (!id) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }
  if (!(await articleExists(id))) {
    return NextResponse.json({ ok: false, error: "Article not found" }, { status: 404 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const systemWriter =
    typeof body.system_writer === "string" && body.system_writer.trim().length > 0
      ? body.system_writer
      : SYSTEM_WRITER;

  const systemCritic =
    typeof body.system_critic === "string" && body.system_critic.trim().length > 0
      ? body.system_critic
      : SYSTEM_CRITIC;

  const result = await runWriterAndCriticForArticle(id, {
    systemWriter,
    systemCritic,
    model: body.model,
  });

  return NextResponse.json(result);
}
