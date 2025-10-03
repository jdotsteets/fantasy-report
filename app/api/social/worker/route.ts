// app/api/social/worker/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Client } from "twitter-api-sdk";
import { dbQuery, dbQueryRows } from "@/lib/db";
import { getFreshXBearer } from "@/app/src/social/xAuth";
import { generateBriefForArticle } from "@/lib/agent/generateBrief";
import { getBriefByArticleId } from "@/lib/briefs";

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

type Result = { processed: number; postedIds: number[]; skipped: number; dry?: boolean };

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // unlocked in dev
  const header = req.headers.get("x-cron-secret");
  const query = new URL(req.url).searchParams.get("cron_secret");
  return header === secret || query === secret;
}

function stripRawLinks(text: string): string {
  return text.replace(/\bhttps?:\/\/\S+/gi, "").replace(/\s{2,}/g, " ").trim();
}

function baseUrl(): string {
  const b = process.env.NEXT_PUBLIC_BASE_URL ?? "https://www.thefantasyreport.com";
  return b.replace(/\/+$/, "");
}

async function ensureBriefShortlink(article_id: number): Promise<string> {
  let brief = await getBriefByArticleId(article_id);
  if (!brief) {
    const gen = await generateBriefForArticle(article_id, true); // autopublish
    return `${baseUrl()}/b/${gen.created_brief_id}`;
  }
  return `${baseUrl()}/b/${brief.id}`;
}

async function runOnce(dry = false): Promise<Result> {
  const bearer = await getFreshXBearer();
  if (!bearer) return { processed: 0, postedIds: [], skipped: 0, dry };

  // Pull due items (status=scheduled and ready)
  const due = await dbQueryRows<DueRow>(
    `select d.id,
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
      limit 10`
  );
  if (due.length === 0) return { processed: 0, postedIds: [], skipped: 0, dry };

  const client = new Client(bearer);
  const postedIds: number[] = [];
  let skipped = 0;

  for (const row of due) {
    let short = "";
    try {
      short = await ensureBriefShortlink(row.article_id);
    } catch {
      skipped += 1;
      await dbQuery(`update social_drafts set status='failed', updated_at=now() where id=$1`, [row.id]);
      continue;
    }

    const parts: string[] = [row.hook, stripRawLinks(row.body)];
    if (row.cta) parts.push(row.cta);
    parts.push(short);

    let text = parts.filter(Boolean).join(" ").replace(/\s{2,}/g, " ").trim();
    if (text.length > 270) text = text.slice(0, 267) + "…";

    if (dry) {
      postedIds.push(row.id);
      continue;
    }

    try {
      const res = await client.tweets.createTweet({ text });
      if (res.data?.id) {
        await dbQuery(`update social_drafts set status='published', updated_at=now() where id=$1`, [row.id]);
        postedIds.push(row.id);
      } else {
        skipped += 1;
        await dbQuery(`update social_drafts set status='failed', updated_at=now() where id=$1`, [row.id]);
      }
    } catch {
      skipped += 1;
      await dbQuery(`update social_drafts set status='failed', updated_at=now() where id=$1`, [row.id]);
    }
  }

  return { processed: due.length, postedIds, skipped, dry };
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const dry = req.nextUrl.searchParams.get("dry") === "1";
  const result = await runOnce(dry);
  return NextResponse.json(result);
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const dry = req.nextUrl.searchParams.get("dry") === "1";
  const result = await runOnce(dry);
  return NextResponse.json(result);
}
