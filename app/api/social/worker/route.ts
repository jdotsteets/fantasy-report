// app/api/social/worker/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Client } from "twitter-api-sdk";
import { dbQuery, dbQueryRows } from "@/lib/db";

// run in Node runtime
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DueRow = {
  id: number;
  hook: string;
  body: string;
  cta: string | null;
  article_url: string | null;
};

async function runOnce(): Promise<{ processed: number; postedIds: number[]; skipped: number }> {
  // 1) load X token
  const tokenRows = await dbQueryRows<{ access_token: string }>(
    `select access_token
     from social_oauth_tokens
     where platform = 'x'
     order by updated_at desc
     limit 1`
  );
  if (tokenRows.length === 0) {
    return { processed: 0, postedIds: [], skipped: 0 };
  }
  const bearer = tokenRows[0].access_token;

  // 2) fetch items due now (join your helpful view)
  const due = await dbQueryRows<DueRow>(
    `select d.id, d.hook, d.body, d.cta, q.article_url
     from social_drafts d
     join v_social_queue q on q.id = d.id
     where d.platform = 'x'
       and d.status = 'scheduled'
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
    const parts = [row.hook, row.body];
    if (row.cta) parts.push(row.cta);
    if (row.article_url) parts.push(row.article_url);
    let text = parts.filter(Boolean).join(" ");

    // simple hard limit for X text (leave a little buffer)
    if (text.length > 270) text = text.slice(0, 267) + "…";

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
    } catch (err) {
      skipped += 1;
      // optionally log err with console.error; mark failed
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

// Provide BOTH methods so you can trigger from curl (POST) and browser (GET)
export async function POST(_req: NextRequest) {
  const result = await runOnce();
  return NextResponse.json(result);
}

export async function GET(_req: NextRequest) {
  const result = await runOnce();
  return NextResponse.json(result);
}
