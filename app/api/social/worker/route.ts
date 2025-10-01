//app/apit/social/worker/route.ts

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

function stripRawLinks(text: string): string {
  // remove any http(s)://... tokens to avoid leaking the source
  return text.replace(/\bhttps?:\/\/\S+/gi, "").replace(/\s{2,}/g, " ").trim();
}

function baseUrl(): string {
  const b = process.env.NEXT_PUBLIC_BASE_URL ?? "https://www.thefantasyreport.com";
  return b.replace(/\/+$/, "");
}

async function ensureBriefShortlink(article_id: number): Promise<string> {
  // 1) ensure a brief exists (published if possible)
  let brief = await getBriefByArticleId(article_id);
  if (!brief) {
    const gen = await generateBriefForArticle(article_id, true); // autopublish
    // you can also re-query if you prefer; we trust gen return
    return `${baseUrl()}/b/${gen.created_brief_id}`;
  }
  return `${baseUrl()}/b/${brief.id}`;
}

async function runOnce(dry = false): Promise<Result> {
  const bearer = await getFreshXBearer();
  if (!bearer) return { processed: 0, postedIds: [], skipped: 0, dry };

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
    // Always build a brief shortlink; create the brief if missing.
    let short = "";
    try {
      short = await ensureBriefShortlink(row.article_id);
    } catch {
      // if even that fails, skip this item so we don't post a raw link
      skipped += 1;
      await dbQuery(
        `update social_drafts set status='failed', updated_at=now() where id=$1`,
        [row.id]
      );
      continue;
    }

    // compose text (strip raw links)
    const parts: string[] = [row.hook, stripRawLinks(row.body)];
    if (row.cta) parts.push(row.cta);
    parts.push(short);

    let text = parts.filter(Boolean).join(" ").replace(/\s{2,}/g, " ").trim();
    if (text.length > 270) text = text.slice(0, 267) + "…";

    if (dry) {
      // simulate success
      postedIds.push(row.id);
      continue;
    }

    try {
      const res = await client.tweets.createTweet({ text });
      if (res.data?.id) {
        await dbQuery(
          `update social_drafts set status='published', updated_at=now() where id=$1`,
          [row.id]
        );
        postedIds.push(row.id);
      } else {
        skipped += 1;
        await dbQuery(
          `update social_drafts set status='failed', updated_at=now() where id=$1`,
          [row.id]
        );
      }
    } catch {
      skipped += 1;
      await dbQuery(
        `update social_drafts set status='failed', updated_at=now() where id=$1`,
        [row.id]
      );
    }
  }

  return { processed: due.length, postedIds, skipped, dry };
}

export async function POST(req: NextRequest) {
  const dry = req.nextUrl.searchParams.get("dry") === "1";
  const result = await runOnce(dry);
  return NextResponse.json(result);
}

export async function GET(req: NextRequest) {
  const dry = req.nextUrl.searchParams.get("dry") === "1";
  const result = await runOnce(dry);
  return NextResponse.json(result);
}
