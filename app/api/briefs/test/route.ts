import { NextResponse } from "next/server";
import { generateBriefForArticle } from "@/lib/agent/generateBrief";
import { dbQueryRows } from "@/lib/db";
import { callLLMWriter, callLLMCritic } from "@/lib/agent/llm";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json();
  const { articleId, url, system_writer, system_critic, model, temperature } = body ?? {};

  // resolve articleId from URL if provided
  let id = articleId;
  if (!id && url) {
    const rows = await dbQueryRows<{ id: number }>(
      `SELECT id FROM articles WHERE url=$1 OR canonical_url=$1 ORDER BY id DESC LIMIT 1`, [url]
    );
    id = rows[0]?.id;
  }
  if (!id) return NextResponse.json({ error: "No matching article" }, { status: 400 });

  // monkey-patch prompts just for this call
  const writer = (args: any) => callLLMWriter({ ...args, system: system_writer ?? args.system, model });
  const critic = (args: any) => callLLMCritic({ ...args, system: system_critic ?? args.system, model });

  // call the generator in a dry-run mode that returns intermediates
  const res = await (await import("@/lib/agent/testHarness")).generateBriefDryRun({
    article_id: id,
    writerFn: writer,
    criticFn: critic,
    temperature: typeof temperature === "number" ? temperature : 0.2,
  });

  return NextResponse.json(res);
}
