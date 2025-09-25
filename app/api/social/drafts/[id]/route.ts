// app/api/social/drafts/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = { params: { id: string } };

export async function PATCH(
  req: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const { id } = context.params;

  // Example body parsing (keep typed as unknown until validated)
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  // TODO: validate `body` and update draft `id`
  return NextResponse.json({ ok: true, id, body }, { status: 200 });
}

export async function GET(
  _req: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const { id } = context.params;
  return NextResponse.json({ ok: true, id });
}
