// app/api/social/publish-now/[id]/route.ts

import { NextResponse } from "next/server";
import { Client } from "twitter-api-sdk";
import { dbQuery, dbQueryRows } from "@/lib/db";
import { getFreshXBearer } from "@/app/src/social/xAuth";
import { generateBriefForArticle } from "@/lib/agent/generateBrief";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DraftRow = {
  id: number;
  article_id: number;
  hook: string;
  body: string;
  cta: string | null;
  article_url: string | null; // not needed anymore for link, but keeping since v_social_queue returns it
  platform: "x";
  status: "draft" | "approved" | "scheduled" | "published" | "failed";
};

type BriefRow = {
  id: number;
  slug: string;
  status: "draft" | "published" | "archived";
};

function composeText(parts: string[]): string {
  let text = parts.filter(Boolean).join(" ");
  // leave a little room; twitter hard limit is 280
  if (text.length > 280) {
    // trim gracefully, then add ellipsis
    const room = 279; // 279 + '…' = 280 if needed
    text = text.slice(0, room).replace(/\s+[^\s]*$/, ""); // avoid mid-word cut
    if (text.length < 280) text += "…";
  }
  return text;
}

async function getExistingBrief(articleId: number): Promise<BriefRow | null> {
  const rows = await dbQueryRows<BriefRow>(
    `select id, slug, status from briefs where article_id = $1 limit 1`,
    [articleId]
  );
  return rows[0] ?? null;
}

function briefShortLink(briefId: number): string {
  const base =
    process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/+$/, "") ??
    "https://www.thefantasyreport.com";
  return `${base}/b/${briefId}`;
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> } // Next 15: params is a Promise
) {
  const { id } = await ctx.params;
  const idNum = Number(id);
  if (!Number.isFinite(idNum)) {
    return NextResponse.json({ error: "Bad id" }, { status: 400 });
  }

  // 1) Load the draft with article context
  const rows = await dbQueryRows<DraftRow>(
    `
    select d.id,
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
     limit 1
    `,
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

  // 2) Ensure a published brief exists; if not, generate & publish one.
  let brief = await getExistingBrief(row.article_id);
  if (!brief || brief.status !== "published") {
    try {
      // autopublish=true, overwrite=false (keep existing published content if present)
      const gen = await generateBriefForArticle(row.article_id, true /* autopublish */, false /* overwrite */);
      brief = { id: Number(gen.created_brief_id), slug: gen.slug, status: "published" };
    } catch (e) {
      // If brief generation fails, don't block posting entirely—fallback to article_url (if available)
      // But we still record failure status below if X posting fails.
      // We continue; link will fallback to raw article if brief is still null.
      // eslint-disable-next-line no-console
      console.error("ensure brief failed:", e);
    }
  }

  // 3) Build link: prefer brief shortlink (/b/{id}); fallback to article_url or nothing
  const linkToUse =
    brief?.id ? briefShortLink(brief.id) : (row.article_url ?? null);

  // 4) Compose tweet text
  const parts: string[] = [row.hook, row.body];
  if (row.cta) parts.push(row.cta);
  if (linkToUse) parts.push(linkToUse);
  const text = composeText(parts);

  // 5) Ensure fresh X bearer
  const bearer = await getFreshXBearer();
  if (!bearer) {
    return NextResponse.json({ error: "X not connected" }, { status: 400 });
  }

  // 6) Post to X
  const client = new Client(bearer);

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

    // Mark as published
    await dbQuery(
      `update social_drafts
          set status='published', updated_at=now()
        where id=$1`,
      [row.id]
    );

    return NextResponse.json({
      ok: true,
      tweetId,
      used_link: linkToUse ?? null,
      brief_id: brief?.id ?? null
    });
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
