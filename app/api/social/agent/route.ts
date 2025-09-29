// app/api/social/agent/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { fetchFreshTopics } from "@/app/src/inputs/topics";
import { renderDrafts } from "@/app/src/writing/renderDrafts";
import { dbQuery, dbQueryRows } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Platform = "x";

const MAX_TOPICS = 8;
const VARIANTS_PER_TOPIC = 2;
const LOOKBACK_HOURS_DEDUPE = 36;
const DEFAULT_PLATFORMS: Platform[] = ["x"];

type DraftLike = {
  topicRef: string | number; // article_id
  hook: string;
  body: string;
  cta?: string | null;
  platform: Platform;
};

type DraftInsertRow = {
  article_id: number;
  platform: Platform;
  status: "draft";
  hook: string;
  body: string;
  cta: string | null;
  media_url: string | null;
};

async function getRecentlyQueuedArticleIds(
  candidateIds: number[],
  lookbackHours: number
): Promise<Set<number>> {
  if (candidateIds.length === 0) return new Set<number>();
  const rows = await dbQueryRows<{ article_id: number }>(
    `
    select distinct article_id
      from social_drafts
     where article_id = any($1::int[])
       and created_at > now() - interval '${lookbackHours} hours'
    `,
    [candidateIds]
  );
  return new Set(rows.map((r) => r.article_id));
}

function toArticleId(d: DraftLike): number {
  const n = Number(d.topicRef);
  return Number.isFinite(n) ? n : NaN;
}

async function runAgent(dry: boolean): Promise<{ ok: true; drafted: number; dry: boolean; note?: string }> {
  // 1) Choose topics
  const topics = await fetchFreshTopics({ windowHours: 24, maxItems: MAX_TOPICS });
  if (topics.length === 0) return { ok: true, drafted: 0, dry, note: "no topics found" };

  // 2) Render variants
  const drafts = await renderDrafts(topics, {
    platforms: DEFAULT_PLATFORMS,
    variantsPerTopic: VARIANTS_PER_TOPIC,
  });
  if (drafts.length === 0) return { ok: true, drafted: 0, dry, note: "no renderable drafts" };

  // 3) De-dupe by article_id (lookback)
  const candidateIds = drafts.map((d) => toArticleId(d as DraftLike)).filter((n) => Number.isFinite(n));
  const recent = await getRecentlyQueuedArticleIds(candidateIds, LOOKBACK_HOURS_DEDUPE);

  const fresh = (drafts as DraftLike[]).filter((d) => {
    const aid = toArticleId(d);
    return Number.isFinite(aid) && !recent.has(aid);
  });

  if (fresh.length === 0) return { ok: true, drafted: 0, dry, note: "all topics recently queued" };

  // 4) Build rows (status = draft, no schedule)
  const rows: DraftInsertRow[] = fresh.map((d) => ({
    article_id: toArticleId(d),
    platform: d.platform,
    status: "draft",
    hook: d.hook,
    body: d.body,
    cta: d.cta ?? null,
    media_url: null,
  }));

  if (dry) {
    return { ok: true, drafted: rows.length, dry, note: "dry-run (no insert)" };
  }

  // 5) Bulk insert
  const values = rows
    .map((_r, i) => {
      const j = i * 7;
      return `($${j + 1},$${j + 2},$${j + 3},$${j + 4},$${j + 5},$${j + 6},$${j + 7})`;
    })
    .join(", ");

  const params = rows.flatMap((r) => [
    r.article_id,
    r.platform,
    r.status,
    r.hook,
    r.body,
    r.cta,
    r.media_url,
  ]);

  await dbQuery(
    `insert into social_drafts
      (article_id, platform, status, hook, body, cta, media_url)
     values ${values}`,
    params
  );

  return { ok: true, drafted: rows.length, dry };
}

export async function GET(req: NextRequest) {
  const dry = req.nextUrl.searchParams.get("dry") === "1";
  const result = await runAgent(dry);
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  let dry = false;
  try {
    const body = (await req.json()) as { dry?: boolean };
    dry = body?.dry === true;
  } catch {
    // no body → dry=false
  }
  const result = await runAgent(dry);
  return NextResponse.json(result);
}
