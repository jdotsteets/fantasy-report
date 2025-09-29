// app/b/[id]/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { dbQueryRows } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = { id: number; slug: string };

export async function GET(
  _req: NextRequest,
  ctx: { params: { id: string } }
) {
  const idNum = Number(ctx.params.id);
  if (!Number.isFinite(idNum)) {
    return NextResponse.redirect(new URL("/", _req.url), 302);
  }

  const rows = await dbQueryRows<Row>(
    `SELECT id, slug FROM briefs WHERE id = $1 LIMIT 1`,
    [idNum]
  );
  const b = rows[0];
  if (!b?.slug) {
    return NextResponse.redirect(new URL("/", _req.url), 302);
  }

  // UTM tags for analytics
  const target = new URL(`/brief/${b.slug}`, _req.url);
  target.searchParams.set("utm_source", "x");
  target.searchParams.set("utm_medium", "social");
  target.searchParams.set("utm_campaign", "auto_brief");

  return NextResponse.redirect(target, 302);
}
