// app/api/test-brief/[id]/route.ts
import { NextResponse } from "next/server";
import { testBriefDryRun } from "@/lib/agent/testHarness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = { id: string };
type RouteCtx = { params: Promise<RouteParams> };

export async function GET(_req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params;              // 👈 await the async params
  const articleId = Number(id);

  if (!Number.isFinite(articleId)) {
    return NextResponse.json({ error: "Invalid article id" }, { status: 400 });
  }

  const result = await testBriefDryRun({ article_id: articleId });
  return NextResponse.json(result);
}
