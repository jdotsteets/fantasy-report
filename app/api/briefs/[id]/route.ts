// app/api/briefs/[id]/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { updateBrief } from "@/lib/briefs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, ctx: unknown) {
  const paramsObj = (ctx as { params?: Record<string, string | string[]> }).params;
  const idRaw = paramsObj?.id;
  const idStr = Array.isArray(idRaw) ? idRaw[0] : idRaw;
  const idNum = Number(idStr);
  if (!Number.isFinite(idNum)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const raw = (await req.json()) as unknown;
  const body = (typeof raw === "object" && raw !== null ? raw : {}) as {
    summary?: unknown;
    why_matters?: unknown;
    seo_title?: unknown;
    seo_description?: unknown;
    status?: unknown;
    slug?: unknown;
  };

  const patch: Partial<{
    summary: string;
    why_matters: string[];
    seo_title: string | null;
    seo_description: string | null;
    status: "draft" | "published" | "archived";
    slug: string;
  }> = {};

  if (typeof body.summary === "string") patch.summary = body.summary;
  if (Array.isArray(body.why_matters) && body.why_matters.every(v => typeof v === "string")) {
    patch.why_matters = body.why_matters as string[];
  }
  if (typeof body.seo_title === "string" || body.seo_title === null) {
    patch.seo_title = (body.seo_title as string | null) ?? null;
  }
  if (typeof body.seo_description === "string" || body.seo_description === null) {
    patch.seo_description = (body.seo_description as string | null) ?? null;
  }
  if (body.status === "draft" || body.status === "published" || body.status === "archived") {
    patch.status = body.status;
  }
  if (typeof body.slug === "string") patch.slug = body.slug;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  try {
    const updated = await updateBrief(idNum, patch);
    return NextResponse.json(updated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
