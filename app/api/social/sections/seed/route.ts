// app/api/social/sections/seed/route.ts
import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Section =
  | "waivers"
  | "rankings"
  | "news"
  | "injuries"
  | "start-sit";

const SECTION_LINK: Record<Section, string> = {
  waivers: "https://www.thefantasyreport.com/waivers",
  rankings: "https://www.thefantasyreport.com/rankings",
  news: "https://www.thefantasyreport.com/news",
  injuries: "https://www.thefantasyreport.com/injuries",
  "start-sit": "https://www.thefantasyreport.com/start-sit",
};

const TEMPLATES: Record<Section, { hook: string; body: string }> = {
  waivers: {
    hook: "Waiver Wire priorities for this week:",
    body:
      "Don’t chase box scores—chase usage. Fresh adds + stash targets inside.",
  },
  rankings: {
    hook: "Weekly Rankings are live ✅",
    body:
      "Tiered RB/WR/TE/QB updates + notes so you can set it and forget it.",
  },
  news: {
    hook: "Today’s biggest NFL headlines (quick hits):",
    body:
      "Context > noise. We pull the takeaways that actually matter for lineups.",
  },
  injuries: {
    hook: "Injury Roundup you need before locks:",
    body:
      "Practice reports, game-time decisions, and contingency plans.",
  },
  "start-sit": {
    hook: "Start/Sit calls for this slate:",
    body:
      "Who’s in your flex? Use matchups + usage to break ties.",
  },
};

// Schedules the post to go out ~now; worker (*/10 min) picks it up.
// If you prefer an exact timestamp, pass &delay=minutes in the query.
export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const typeParam = (url.searchParams.get("type") || "").toLowerCase();
  const section = (["waivers", "rankings", "news", "injuries", "start-sit"] as Section[])
    .find((s) => s === typeParam) as Section | undefined;

  if (!section) {
    return NextResponse.json(
      { error: "Missing or invalid ?type=waivers|rankings|news|injuries|start-sit" },
      { status: 400 }
    );
  }

  const delayMin = Math.max(
    0,
    Number.isFinite(Number(url.searchParams.get("delay"))) ? Number(url.searchParams.get("delay")) : 1
  );
  const scheduledForIso = new Date(Date.now() + delayMin * 60_000).toISOString();

  const tpl = TEMPLATES[section];
  const link = SECTION_LINK[section];

  // Insert a scheduled draft with a site section link
  await dbQuery(
    `insert into social_drafts (article_id, platform, status, hook, body, cta, media_url, scheduled_for)
     values (0, 'x', 'scheduled', $1, $2, $3, null, $4)`,
    [tpl.hook, tpl.body, link, scheduledForIso]
  );

  return NextResponse.json({
    ok: true,
    section,
    scheduled_for: scheduledForIso,
    link,
  });
}
