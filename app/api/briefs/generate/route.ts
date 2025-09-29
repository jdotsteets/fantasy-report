// app/api/briefs/generate/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { generateBriefForArticle } from "@/lib/agent/generateBrief";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { article_id?: unknown; autopublish?: unknown };
    const article_id = Number(body.article_id);
    const autopublish = Boolean(body.autopublish);
    if (!Number.isFinite(article_id) || article_id <= 0) {
      return NextResponse.json({ error: "Invalid article_id" }, { status: 400 });
    }
    const result = await generateBriefForArticle(article_id, autopublish);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
