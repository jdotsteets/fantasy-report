// app/api/social/publish-thread/[section]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { fetchSectionItems, type SectionKey } from "@/lib/sectionQuery";
import { buildThread } from "@/lib/social/threadBuilder";
import { postThread } from "@/lib/social/x";

// Node runtime is required for crypto (OAuth) and fetch to X API v1.1
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { section: string };

function toSectionKey(s: string): Extract<SectionKey, "waiver-wire" | "start-sit"> | null {
  if (s === "waiver-wire" || s === "start-sit") return s;
  return null;
}

export async function POST(req: NextRequest, ctx: { params: Promise<Params> }) {
  const { section } = await ctx.params;
  const key = toSectionKey(section);
  if (!key) {
    return NextResponse.json({ ok: false, error: "Unsupported section. Use 'waiver-wire' or 'start-sit'." }, { status: 400 });
  }

  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") ?? "5");
  const dry = url.searchParams.get("dry") === "1" || url.searchParams.get("dry") === "true";

  // Optional: accept week from query (?week=5). If omitted, we leave it null.
  const weekParam = url.searchParams.get("week");
  const week = weekParam ? Number(weekParam) : null;

  // Pull the latest items with your existing function.
  // - maxAgeHours omitted for non-news sections
  // - perProviderCap is enforced inside fetchSectionItems unless filters are set
  const rows = await fetchSectionItems({
    key,
    limit: Math.max(1, Math.min(limit, 10)),
    offset: 0,
    days: 21,                 // recent 3 weeks window feels right for these sections
    week: week ?? null,       // use if provided
    staticMode: "exclude",
    perProviderCap: 3,        // align w/ your current policy
    sport: "nfl",
  });

  if (!rows.length) {
    return NextResponse.json({ ok: false, error: "No items found for section." }, { status: 404 });
  }

  const posts = buildThread({ section: key, weekHint: week ?? null, maxItems: limit }, rows);

  try {
    const result = await postThread(posts, dry);
    return NextResponse.json({
      ok: true,
      section: key,
      week,
      count: posts.length,
      postedIds: result.ids,
      dry: result.dry,
      preview: dry ? posts : undefined, // show the composed thread on dry run
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message, preview: posts },
      { status: 500 }
    );
  }
}

// Convenience GET to preview (dry-run) without posting.
export async function GET(req: NextRequest, ctx: { params: Promise<Params> }) {
  const url = new URL(req.url);
  url.searchParams.set("dry", "1");
  const newReq = new NextRequest(url.toString(), { method: "POST", headers: req.headers });
  return POST(newReq, ctx);
}
