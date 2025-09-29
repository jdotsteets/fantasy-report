//app/api/social/worker/route.ts

import { NextResponse, type NextRequest } from "next/server";
import { Client } from "twitter-api-sdk";
import { dbQuery, dbQueryRows } from "@/lib/db";
import { getFreshXBearer } from "@/app/src/social/xAuth";
import { generateBriefForArticle } from "@/lib/agent/generateBrief";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";




type DueRow = {
  id: number;
  article_id: number;
  hook: string;
  body: string;
  cta: string | null;
  article_url: string | null;
};

type BriefRow = { id: number; slug: string; status: "draft" | "published" | "archived" };

type RunResult = {
  processed: number;
  postedIds: number[];
  skipped: number;
  dry: boolean;
  note?: string;
};

function composeText(parts: string[]): string {
  let text = parts.filter(Boolean).join(" ");
  if (text.length > 280) {
    const room = 279;
    text = text.slice(0, room).replace(/\s+[^\s]*$/, "");
    if (text.length < 280) text += "…";
  }
  return text;
}

function briefShortLink(briefId: number): string {
  const base =
    process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/+$/, "") ??
    "https://www.thefantasyreport.com";
  return `${base}/b/${briefId}`;
}

async function getExistingBrief(articleId: number): Promise<BriefRow | null> {
  const rows = await dbQueryRows<BriefRow>(
    `select id, slug, status from briefs where article_id = $1 limit 1`,
    [articleId]
  );
  return rows[0] ?? null;
}

async function ensureBriefPublished(articleId: number): Promise<BriefRow | null> {
  const existing = await getExistingBrief(articleId);
  if (existing?.status === "published") return existing;

  try {
    const gen = await generateBriefForArticle(articleId, true /* autopublish */, false /* overwrite */);
    return { id: Number(gen.created_brief_id), slug: gen.slug, status: "published" };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("ensureBriefPublished failed:", e);
    return existing ?? null;
  }
}

async function fetchDue(limit: number): Promise<DueRow[]> {
  return dbQueryRows<DueRow>(
    `
    select d.id,
           d.article_id,
           d.hook,
           d.body,
           d.cta,
           q.article_url
      from social_drafts d
      join v_social_queue q on q.id = d.id
     where d.platform = 'x'
       and d.status   = 'scheduled'
       and d.scheduled_for is not null
       and d.scheduled_for <= now()
     order by d.id
     limit $1
    `,
    [limit]
  );
}

async function markStatus(id: number, status: "published" | "failed"): Promise<void> {
  await dbQuery(
    `update social_drafts
        set status = $1, updated_at = now()
      where id = $2`,
    [status, id]
  );
}

async function runWorker(dry: boolean): Promise<RunResult> {
  const bearer = await getFreshXBearer();
  if (!bearer) {
    return { processed: 0, postedIds: [], skipped: 0, dry, note: "no X bearer" };
  }

  const due = await fetchDue(10);
  if (due.length === 0) {
    return { processed: 0, postedIds: [], skipped: 0, dry, note: "none due" };
  }

  const client = new Client(bearer);
  const postedIds: number[] = [];
  let skipped = 0;

  for (const row of due) {
    let linkToUse: string | null = null;
    const brief = await ensureBriefPublished(row.article_id);
    if (brief?.id) linkToUse = briefShortLink(brief.id);
    else if (row.article_url) linkToUse = row.article_url;

    const parts: string[] = [row.hook, row.body];
    if (row.cta) parts.push(row.cta);
    if (linkToUse) parts.push(linkToUse);
    const text = composeText(parts);

    if (dry) {
      // simulate success without side effects
      postedIds.push(row.id);
      continue;
    }

    try {
      const res = await client.tweets.createTweet({ text });
      if (res.data?.id) {
        await markStatus(row.id, "published");
        postedIds.push(row.id);
      } else {
        skipped += 1;
        await markStatus(row.id, "failed");
      }
    } catch {
      skipped += 1;
      await markStatus(row.id, "failed");
    }
  }

  return { processed: due.length, postedIds, skipped, dry };
}

export async function GET(req: NextRequest) {
  const dry = req.nextUrl.searchParams.get("dry") === "1";
  const result = await runWorker(dry);
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
  const result = await runWorker(dry);
  return NextResponse.json(result);
}
