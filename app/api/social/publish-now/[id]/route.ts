// app/api/social/publish-now/[id]/route.ts
import { NextResponse } from "next/server";
import { Client } from "twitter-api-sdk";
import { dbQuery, dbQueryRows } from "@/lib/db";
import { getFreshXBearer } from "@/app/src/social/xAuth";
import { ensureShortlinkForArticle } from "@/app/src/links/short";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DraftRow = {
  id: number;
  article_id: number;
  hook: string;
  body: string;
  cta: string | null;
  article_url: string | null;
  platform: "x";
  status: "draft" | "approved" | "scheduled" | "published" | "failed";
};

function composeText(parts: string[]): string {
  let text = parts.filter(Boolean).join(" ");
  if (text.length > 270) text = text.slice(0, 267) + "…";
  return text;
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> } // 👈 Next 15 passes params as a Promise
) {
  const { id } = await ctx.params;        // 👈 await it
  const idNum = Number(id);
  if (!Number.isFinite(idNum)) {
    return NextResponse.json({ error: "Bad id" }, { status: 400 });
  }

  // 1) Load the draft with article_id + article_url
  const rows = await dbQueryRows<DraftRow>(
    `select d.id,
            d.article_id,
            d.hook,
            d.body,
            d.cta,
            q.article_url,
            d.platform,
            d.status
       from social_drafts d
       join v_social_queue q on q.id = d.id
      where d.id = $1
      limit 1`,
    [idNum]
  );
  if (rows.length === 0) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }
  const row = rows[0];

  if (row.platform !== "x") {
    return NextResponse.json({ error: "Only X supported here" }, { status: 400 });
  }
  if (row.status === "published") {
    return NextResponse.json({ ok: true, note: "Already published" });
  }

  // 2) Build shortlink (fallback to raw URL if needed)
  let linkToUse: string | null = null;
  if (row.article_url) {
    try {
      linkToUse = await ensureShortlinkForArticle(row.article_id, row.article_url, "x-post");
    } catch {
      linkToUse = row.article_url;
    }
  }

  // 3) Ensure fresh bearer (refresh if expired)
  const bearer = await getFreshXBearer();
  if (!bearer) {
    return NextResponse.json({ error: "X not connected" }, { status: 400 });
  }

  // 4) Compose and post
  const parts: string[] = [row.hook, row.body];
  if (row.cta) parts.push(row.cta);
  if (linkToUse) parts.push(linkToUse);

  const client = new Client(bearer);
  const text = composeText(parts);

  try {
    const res = await client.tweets.createTweet({ text });
    const tweetId = res.data?.id ?? null;

    if (!tweetId) {
      await dbQuery(
        `update social_drafts
            set status='failed', updated_at=now()
          where id=$1`,
        [row.id]
      );
      return NextResponse.json({ error: "Tweet failed" }, { status: 502 });
    }

    await dbQuery(
      `update social_drafts
          set status='published', updated_at=now()
        where id=$1`,
      [row.id]
    );

    return NextResponse.json({ ok: true, tweetId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await dbQuery(
      `update social_drafts
          set status='failed', updated_at=now()
        where id=$1`,
      [row.id]
    );
    return NextResponse.json({ error: "Tweet error", detail: msg }, { status: 502 });
  }
}
