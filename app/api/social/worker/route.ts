// app/api/social/worker/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Client } from "twitter-api-sdk";
import { dbQuery, dbQueryRows } from "@/lib/db";
import { getFreshXBearer } from "@/app/src/social/xAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DueRow = {
  id: number;
  hook: string;
  body: string;
  cta: string | null;
  article_url: string | null;
};

type Result = { processed: number; postedIds: number[]; skipped: number };

async function runOnce(): Promise<Result> {
  // 1) ensure we have a fresh access token (auto-refresh if expired/near-expiry)
  const bearer = await getFreshXBearer();
  if (!bearer) {
    return { processed: 0, postedIds: [], skipped: 0 };
  }

  // 2) fetch items due now
  const due = await dbQueryRows<DueRow>(
    `select d.id, d.hook, d.body, d.cta, q.article_url
       from social_drafts d
       join v_social_queue q on q.id = d.id
      where d.platform = 'x'
        and d.status   = 'scheduled'
        and d.scheduled_for is not null
        and d.scheduled_for <= now()
      order by d.id
      limit 10`
  );

  if (due.length === 0) {
    return { processed: 0, postedIds: [], skipped: 0 };
  }

  const client = new Client(bearer);
  const postedIds: number[] = [];
  let skipped = 0;

  for (const row of due) {
    const parts: string[] = [row.hook, row.body];
    if (row.cta) parts.push(row.cta);
    if (row.article_url) parts.push(row.article_url);

    let text = parts.filter(Boolean).join(" ");
    if (text.length > 270) text = text.slice(0, 267) + "…"; // X text guard

    try {
      const res = await client.tweets.createTweet({ text });
      if (res.data?.id) {
        await dbQuery(
          `update social_drafts
              set status = 'published', updated_at = now()
            where id = $1`,
          [row.id]
        );
        postedIds.push(row.id);
      } else {
        skipped += 1;
        await dbQuery(
          `update social_drafts
              set status = 'failed', updated_at = now()
            where id = $1`,
          [row.id]
        );
      }
    } catch {
      skipped += 1;
      await dbQuery(
        `update social_drafts
            set status = 'failed', updated_at = now()
          where id = $1`,
        [row.id]
      );
    }
  }

  return { processed: due.length, postedIds, skipped };
}

export async function POST(_req: NextRequest) {
  const result = await runOnce();
  return NextResponse.json(result);
}

export async function GET(_req: NextRequest) {
  const result = await runOnce();
  return NextResponse.json(result);
}
