import { NextResponse } from "next/server";
import { fetchFreshTopics } from "@/app/src/inputs/topics";
import { renderDrafts } from "@/app/src/writing/renderDrafts";
import { saveDrafts } from "@/app/src/outputs/saveDrafts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  // Pull recent articles (tune as you like)
  const topics = await fetchFreshTopics({ windowHours: 24, maxItems: 8 });
  if (topics.length === 0) {
    return NextResponse.json({ ok: true, drafted: 0, note: "no topics found" });
  }

  // Generate 2 variants per topic for X
  const drafts = await renderDrafts(topics, {
    platforms: ["x"],
    variantsPerTopic: 2,
  });

  // Persist as 'draft' for review in /admin/social
  await saveDrafts(drafts);

  return NextResponse.json({ ok: true, drafted: drafts.length });
}
