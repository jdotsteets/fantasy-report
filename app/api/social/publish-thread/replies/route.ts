// app/api/social/publish-thread/replies/route.ts
import { NextRequest, NextResponse } from "next/server";
import { fetchSectionItems, type SectionKey } from "@/lib/sectionQuery";
import { buildThread } from "@/lib/social/threadBuilder";
import { postReplies, type XPost } from "@/lib/social/x";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ─────────────── Types/consts ─────────────── */

type AllowedSection = Extract<SectionKey, "waiver-wire" | "start-sit">;

const LIMIT_MIN = 1;
const LIMIT_MAX = 10;
const DEFAULT_LIMIT = 5;
const DEFAULT_DAYS = 21;
const DEFAULT_PER_PROVIDER_CAP = 3;

/* ─────────────── Helpers ─────────────── */

function toSectionKey(s: string | null): AllowedSection | null {
  if (!s) return null;
  return s === "waiver-wire" || s === "start-sit" ? s : null;
}
function clampInt(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
function parseIntOrNull(v: string | null): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function parseBool(v: string | null): boolean {
  return v === "1" || v === "true";
}
function toXPost(p: string | { text: string }): XPost {
  return typeof p === "string" ? { text: p } : { text: p.text };
}

/* ─────────────── Route ─────────────── */

/**
 * POST /api/social/publish-thread/replies
 * Query params:
 *   - rootId (required): tweet id to reply to
 *   - section (required): waiver-wire | start-sit
 *   - limit (1–10, default 5)
 *   - days (default 21)
 *   - perProviderCap (default 3)
 *   - week (optional integer)
 *   - paceMs (optional integer; e.g., 9000)
 *   - dry=1 (preview only)
 */
export async function POST(req: NextRequest) {
  // Kill-switch: set DISABLE_POSTERS=1 in env to pause automation
  if (process.env.DISABLE_POSTERS === "1") {
    return NextResponse.json({ ok: false, error: "Posting disabled" }, { status: 503 });
  }

  const url = new URL(req.url);

  const rootId = url.searchParams.get("rootId") ?? "";
  if (!rootId) {
    return NextResponse.json({ ok: false, error: "Missing rootId." }, { status: 400 });
  }

  const key = toSectionKey(url.searchParams.get("section"));
  if (!key) {
    return NextResponse.json(
      { ok: false, error: "Missing or invalid section. Use 'waiver-wire' or 'start-sit'." },
      { status: 400 }
    );
  }

  const dry = parseBool(url.searchParams.get("dry"));

  const limitRaw = parseIntOrNull(url.searchParams.get("limit"));
  const limit = clampInt(limitRaw ?? DEFAULT_LIMIT, LIMIT_MIN, LIMIT_MAX);

  const week = parseIntOrNull(url.searchParams.get("week"));
  const days = clampInt(parseIntOrNull(url.searchParams.get("days")) ?? DEFAULT_DAYS, 1, 60);
  const perProviderCap = clampInt(
    parseIntOrNull(url.searchParams.get("perProviderCap")) ?? DEFAULT_PER_PROVIDER_CAP,
    1,
    10
  );

  const paceMsParam = Number(url.searchParams.get("paceMs") ?? "");
  const paceMs = Number.isFinite(paceMsParam) ? Math.max(0, paceMsParam) : undefined;

  const sport = (url.searchParams.get("sport") ?? "nfl").toLowerCase();

  // Fetch items again to rebuild replies (keeps the flow idempotent)
  let rows;
  try {
    rows = await fetchSectionItems({
      key,
      limit,
      offset: 0,
      days,
      week: week ?? null,
      staticMode: "exclude",
      perProviderCap,
      sport,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "Fetch failed", detail: String(err) },
      { status: 502 }
    );
  }

  if (!rows.length) {
    return NextResponse.json({ ok: false, error: "No items found for section." }, { status: 404 });
  }

  // Build thread, then drop the opener, keep only replies
  const built = buildThread({ section: key, weekHint: week ?? null, maxItems: limit }, rows) as Array<
    string | { text: string }
  >;
  const xPosts: XPost[] = built.map(toXPost);
  const replies = xPosts.slice(1);

  if (dry) {
    return NextResponse.json({
      ok: true,
      section: key,
      week,
      days,
      perProviderCap,
      rootId,
      count: replies.length,
      dry: true,
      preview: replies, // XPost[] for preview
    });
  }

  if (replies.length === 0) {
    return NextResponse.json({
      ok: true,
      section: key,
      week,
      days,
      perProviderCap,
      rootId,
      postedIds: [],
      dry: false,
    });
  }

  try {
    // Convert to the shape expected by postReplies: string[] (texts only)
    const replyTexts = replies.map((r) => r.text);
    const result = await postReplies(replyTexts, rootId, { dry: false, paceMs });
    return NextResponse.json({
      ok: true,
      section: key,
      week,
      days,
      perProviderCap,
      rootId,
      postedIds: result.ids,
      dry: false,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "Replies failed", detail: String(err), rootId, preview: replies },
      { status: 500 }
    );
  }
}

/** Convenience GET for preview (forces dry-run). */
export async function GET(req: NextRequest) {
  const u = new URL(req.url);
  u.searchParams.set("dry", "1");
  const replay = new NextRequest(u.toString(), { method: "POST", headers: req.headers });
  return POST(replay);
}
