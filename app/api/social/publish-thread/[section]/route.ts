// app/api/social/publish-thread/[section]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { fetchSectionItems, type SectionKey } from "@/lib/sectionQuery";
import { buildThread } from "@/lib/social/threadBuilder";
import { postThread } from "@/lib/social/x";

// If XPost is exported from lib/social/x, import it instead:
// import type { XPost } from "@/lib/social/x";
type XPost = { text: string };

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

  const week = parseIntOrNull(url.searchParams.get("week"));
  const days = clampInt(parseIntOrNull(url.searchParams.get("days")) ?? DEFAULT_DAYS, 1, 60);
  const perProviderCap = clampInt(
    parseIntOrNull(url.searchParams.get("perProviderCap")) ?? DEFAULT_PER_PROVIDER_CAP,
    1,
    10
  );

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

  // Thread builder may return string[] or {text:string}[]
  const rawPosts = buildThread({ section: key, weekHint: week ?? null, maxItems: limit }, rows) as Array<
    string | { text: string }
  >;

  // Normalize to XPost[]
  const xPosts: XPost[] = rawPosts.map(toXPost);

  const paceMsParam = parseInt(url.searchParams.get("paceMs") ?? "", 10);
  const paceMs = Number.isFinite(paceMsParam) ? Math.max(0, paceMsParam) : undefined;

  const result = await postThread(xPosts, { dry, paceMs }); // ← uses new options
  
// ...

  try {
    const result = await postThread(xPosts, dry);
    return NextResponse.json({
      ok: true,
      section: key,
      week,
      days,
      perProviderCap,
      count: xPosts.length,
      postedIds: result.ids,
      dry: result.dry,
      preview: dry ? xPosts : undefined, // show composed tweets on dry run
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
