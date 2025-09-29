// app/b/[id]/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { dbQueryRows } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BriefRow = { id: number; slug: string };

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> } // ← Next 15 passes params as a Promise
) {
  const { id } = await ctx.params; // ← await it
  const idNum = Number(id);

  // Fallback to home if id is bad
  const home = new URL("/", req.url);
  if (!Number.isFinite(idNum)) {
    return NextResponse.redirect(home, 302);
  }

  const rows = await dbQueryRows<BriefRow>(
    `SELECT id, slug FROM briefs WHERE id = $1 LIMIT 1`,
    [idNum]
  );
  const brief = rows[0];

  if (!brief?.slug) {
    return NextResponse.redirect(home, 302);
  }

  // Redirect to the canonical brief page with UTMs
  const target = new URL(`/brief/${brief.slug}`, req.url);
  target.searchParams.set("utm_source", "x");
  target.searchParams.set("utm_medium", "social");
  target.searchParams.set("utm_campaign", "auto_brief");

  return NextResponse.redirect(target, 302);
}
