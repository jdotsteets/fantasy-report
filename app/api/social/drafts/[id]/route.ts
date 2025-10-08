// app/api/social/drafts/[id]/route.ts
import { NextResponse } from "next/server";
import { dbQuery, dbQueryRows } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function getIdFromUrl(req: Request): number {
  const { pathname } = new URL(req.url);
  const parts = pathname.replace(/\/+$/, "").split("/");
  const last = decodeURIComponent(parts[parts.length - 1] || "");
  const n = Number(last);
  if (!Number.isFinite(n)) throw new Error("Bad id");
  return n;
}

type DraftStatus = "draft" | "approved" | "scheduled" | "published" | "failed";

type PatchBody = {
  status?: DraftStatus;
  scheduled_for?: string | null; // ISO string or null to clear
};

function isValidStatus(s: unknown): s is DraftStatus {
  return s === "draft" || s === "approved" || s === "scheduled" || s === "published" || s === "failed";
}

function isIsoOrNull(s: unknown): s is string | null {
  if (s === null) return true;
  if (typeof s !== "string") return false;
  const d = new Date(s);
  return !Number.isNaN(d.getTime());
}

function isInPastIso(iso: string): boolean {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t < Date.now();
}

export async function GET(req: Request) {
  try {
    const id = getIdFromUrl(req);
    const rows = await dbQueryRows<{
      id: number;
      article_id: number;
      platform: string;
      status: DraftStatus;
      hook: string;
      body: string;
      cta: string | null;
      scheduled_for: string | null;
      created_at: string;
      updated_at: string;
    }>(`select * from social_drafts where id = $1 limit 1`, [id]);

    if (rows.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, draft: rows[0] });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function PATCH(req: Request) {
  try {
    const id = getIdFromUrl(req);

    let body: PatchBody = {};
    try {
      body = (await req.json()) as PatchBody;
    } catch {
      // empty body allowed
    }

    if (body.status !== undefined && !isValidStatus(body.status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    if (body.scheduled_for !== undefined && !isIsoOrNull(body.scheduled_for)) {
      return NextResponse.json({ error: "scheduled_for must be ISO string or null" }, { status: 400 });
    }

    // Kill-switch: prevent transitions that would trigger auto-posting when disabled
    if (
      process.env.DISABLE_POSTERS === "1" &&
      (body.status === "approved" || body.status === "scheduled" || body.status === "published")
    ) {
      return NextResponse.json(
        { error: "Posting disabled", note: "DISABLE_POSTERS=1 blocks status changes to approved/scheduled/published." },
        { status: 503 }
      );
    }

    // If scheduling without a timestamp, default to +30m
    let scheduledFor: string | null | undefined = body.scheduled_for;
    if (body.status === "scheduled" && scheduledFor === undefined) {
      scheduledFor = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    }

    // Disallow scheduling in the past
    if (scheduledFor && isInPastIso(scheduledFor)) {
      return NextResponse.json({ error: "scheduled_for cannot be in the past" }, { status: 400 });
    }

    // Build dynamic update set
    const sets: string[] = [];
    const params: unknown[] = [];
    let p = 1;

    if (body.status !== undefined) {
      sets.push(`status = $${p++}`);
      params.push(body.status);
    }
    if (scheduledFor !== undefined) {
      sets.push(`scheduled_for = $${p++}`);
      params.push(scheduledFor);
    }

    if (sets.length === 0) {
      return NextResponse.json({ ok: true, note: "nothing to update" });
    }

    params.push(id);
    const sql = `
      update social_drafts
         set ${sets.join(", ")}, updated_at = now()
       where id = $${p}
       returning id, status, scheduled_for
    `;
    const rows = await dbQueryRows<{ id: number; status: DraftStatus; scheduled_for: string | null }>(sql, params);

    if (rows.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, ...rows[0] });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  try {
    const id = getIdFromUrl(req);
    await dbQuery(`delete from social_drafts where id = $1`, [id]);
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
