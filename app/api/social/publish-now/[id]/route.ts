import { NextResponse } from "next/server";
import { Client } from "twitter-api-sdk";
import { dbQuery, dbQueryRows } from "@/lib/db";
import { getFreshXBearer } from "@/app/src/social/xAuth";
import { generateBriefForArticle } from "@/lib/agent/generateBrief";
import { getBriefByArticleId } from "@/lib/briefs";

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
    const gen = await generateBriefForArticle(article_id, true);
    return `${baseUrl()}/b/${gen.created_brief_id}`;
  }
  return `${baseUrl()}/b/${brief.id}`;
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const idNum = Number(id);
  if (!Number.isFinite(idNum)) {
    return NextResponse.json({ error: "Bad id" }, { status: 400 });
  }

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
  if (rows.length === 0) return NextResponse.json({ error: "Draft not found" }, { status: 404 });

  const row = rows[0];
  if (row.platform !== "x") return NextResponse.json({ error: "Only X supported here" }, { status: 400 });
  if (row.status === "published") return NextResponse.json({ ok: true, note: "Already published" });

  const bearer = await getFreshXBearer();
  if (!bearer) return NextResponse.json({ error: "X not connected" }, { status: 400 });

  // Always ensure a brief shortlink
  let short = "";
  try {
    short = await ensureBriefShortlink(row.article_id);
  } catch (e) {
    return NextResponse.json({ error: "Brief link failed", detail: String(e) }, { status: 502 });
  }

  const parts: string[] = [row.hook, stripRawLinks(row.body)];
  if (row.cta) parts.push(row.cta);
  parts.push(short);

  let text = parts.filter(Boolean).join(" ").replace(/\s{2,}/g, " ").trim();
  if (text.length > 270) text = text.slice(0, 267) + "…";

  const client = new Client(bearer);
  try {
    const res = await client.tweets.createTweet({ text });
    const tweetId = res.data?.id ?? null;

    if (!tweetId) {
      await dbQuery(`update social_drafts set status='failed', updated_at=now() where id=$1`, [row.id]);
      return NextResponse.json({ error: "Tweet failed" }, { status: 502 });
    }

    await dbQuery(`update social_drafts set status='published', updated_at=now() where id=$1`, [row.id]);
    return NextResponse.json({ ok: true, tweetId, shortlink: short });
  } catch (e) {
    await dbQuery(`update social_drafts set status='failed', updated_at=now() where id=$1`, [row.id]);
    return NextResponse.json({ error: "Tweet error", detail: String(e) }, { status: 502 });
  }
}
