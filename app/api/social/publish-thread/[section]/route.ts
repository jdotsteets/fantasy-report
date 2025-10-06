// app/api/social/publish-thread/[section]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { fetchSectionItems, type SectionKey } from "@/lib/sectionQuery";
import { buildThread } from "@/lib/social/threadBuilder";
import { postThread, postRoot, postReplies } from "@/lib/social/x";
// If XPost isn't exported from lib/social/x, keep this local type:
export type XPost = { text: string };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ───────────────────────── Types/consts ───────────────────────── */

type Params = { section: string };
type AllowedSection = Extract<SectionKey, "waiver-wire" | "start-sit">;

const LIMIT_MIN = 1;
const LIMIT_MAX = 10;
const DEFAULT_LIMIT = 5;
const DEFAULT_DAYS = 21;
const DEFAULT_PER_PROVIDER_CAP = 3;

/* ───────────────────────── Helpers ───────────────────────── */

function toSectionKey(s: string): AllowedSection | null {
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

/** Accepts either a plain string or { text } and returns a proper XPost. */
function toXPost(p: string | { text: string }): XPost {
  return typeof p === "string" ? { text: p } : { text: p.text };
}

/* ───────────────────────── Route ───────────────────────── */

export async function POST(req: NextRequest, ctx: { params: Promise<Params> }) {
  const { section } = await ctx.params;
  const key = toSectionKey(section);
  if (!key) {
    return NextResponse.json(
      { ok: false, error: "Unsupported section. Use 'waiver-wire' or 'start-sit'." },
      { status: 400 }
    );
  }

  const url = new URL(req.url);

  const limitRaw = parseIntOrNull(url.searchParams.get("limit"));
  const limit = clampInt(limitRaw ?? DEFAULT_LIMIT, LIMIT_MIN, LIMIT_MAX);

  const dry = parseBool(url.searchParams.get("dry"));
  const mode = (url.searchParams.get("mode") ?? "").toLowerCase(); // "", "root", "replies"

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

  // Fetch items for the thread
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

  // Build thread (string[] or {text}[]) → normalize to XPost[]
  const built = buildThread({ section: key, weekHint: week ?? null, maxItems: limit }, rows) as Array<
    string | { text: string }
  >;
  const xPosts: XPost[] = built.map(toXPost);

  // Dry preview: return immediately with composed posts
  if (dry) {
    return NextResponse.json({
      ok: true,
      section: key,
      week,
      days,
      perProviderCap,
      count: xPosts.length,
      postedIds: [],
      dry: true,
      preview: xPosts,
    });
  }

  try {
    // Two-step modes to avoid timeouts or rate limits
    if (mode === "root") {
      if (xPosts.length === 0) {
        return NextResponse.json({ ok: false, error: "Nothing to post." }, { status: 400 });
      }
      const { id } = await postRoot(xPosts[0].text, { dry: false });
      return NextResponse.json({
        ok: true,
        section: key,
        week,
        days,
        perProviderCap,
        rootId: id,
        count: 1,
        dry: false,
      });
    }

    if (mode === "replies") {
      const rootId = url.searchParams.get("rootId") ?? "";
      if (!rootId) {
        return NextResponse.json({ ok: false, error: "Missing rootId for replies." }, { status: 400 });
      }
      const replies = xPosts.slice(1);
      if (replies.length === 0) {
        return NextResponse.json({ ok: true, section: key, week, rootId, postedIds: [], dry: false });
      }
      const result = await postReplies(replies, rootId, { dry: false, paceMs });
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
    }

    // Default: one-shot post (fast by default; pace if provided)
    const result = await postThread(xPosts, { dry: false, paceMs });
    return NextResponse.json({
      ok: true,
      section: key,
      week,
      days,
      perProviderCap,
      count: xPosts.length,
      postedIds: result.ids,
      dry: false,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "Post failed", detail: String(err), preview: xPosts },
      { status: 500 }
    );
  }
}

/** Convenience GET to preview (forces dry-run). */
export async function GET(req: NextRequest, ctx: { params: Promise<Params> }) {
  const u = new URL(req.url);
  u.searchParams.set("dry", "1");
  const replay = new NextRequest(u.toString(), { method: "POST", headers: req.headers });
  return POST(replay, ctx);
}
