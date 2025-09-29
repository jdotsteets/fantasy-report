// app/api/social/worker/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { Client } from "twitter-api-sdk";
import { dbQuery, dbQueryRows } from "@/lib/db";
import { getFreshXBearer } from "@/app/src/social/xAuth";
import { generateBriefForArticle } from "@/lib/agent/generateBrief";
import { ensureShortlinkForArticle, ensureShortlinkForBrief } from "@/app/src/links/short";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DueRow = {
  id: number;
  article_id: number;
  hook: string;
  body: string;
  cta: string | null;
  article_url: string | null;
  brief_id: number | null;     // ← use these
  brief_url: string | null;
};

type BriefRow = { id: number; slug: string; status: "draft" | "published" | "archived" };

type RunResult = { processed: number; postedIds: number[]; skipped: number; dry: boolean; note?: string };

function composeText(parts: string[]): string {
  let text = parts.filter(Boolean).join(" ");
  if (text.length > 280) {
    const room = 279;
    text = text.slice(0, room).replace(/\s+[^\s]*$/, "");
    if (text.length < 280) text += "…";
  }
  return text;
}

async function getExistingBrief(articleId: number): Promise<BriefRow | null> {
  const rows = await dbQueryRows<BriefRow>(
    `select id, slug, status from briefs where article_id = $1 order by published_at desc nulls last limit 1`,
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
  } catch {
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
           q.article_url,
           q.brief_id,
           q.brief_url
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
  await dbQuery(`update social_drafts set status = $1, updated_at = now() where id = $2`, [status, id]);
}

async function runWorker(dry: boolean): Promise<RunResult> {
  const bearer = await getFreshXBearer();
  if (!bearer) return { processed: 0, postedIds: [], skipped: 0, dry, note: "no X bearer" };

  const due = await fetchDue(10);
  if (due.length === 0) return { processed: 0, postedIds: [], skipped: 0, dry, note: "none due" };

  const client = new Client(bearer);
  const postedIds: number[] = [];
  let skipped = 0;

  for (const row of due) {
    // Prefer existing published brief from the view; else try to create/publish; else fall back to article
    let linkToUse: string | null = null;

    try {
      if (row.brief_id && row.brief_url) {
        linkToUse = await ensureShortlinkForBrief(row.brief_id, row.brief_url, "x-brief");
      } else {
        const ensured = await ensureBriefPublished(row.article_id);
        if (ensured?.id && ensured.slug) {
          const url = `https://www.thefantasyreport.com/brief/${ensured.slug}`;
          linkToUse = await ensureShortlinkForBrief(ensured.id, url, "x-brief");
        } else if (row.article_url) {
          linkToUse = await ensureShortlinkForArticle(row.article_id, row.article_url, "x-article");
        }
      }
    } catch {
      // last resort: raw URLs
      linkToUse = row.brief_url ?? row.article_url ?? null;
    }

    const parts: string[] = [row.hook, row.body];
    if (row.cta) parts.push(row.cta);
    if (linkToUse) parts.push(linkToUse);
    const text = composeText(parts);

    if (dry) { postedIds.push(row.id); continue; }

    try {
      const res = await client.tweets.createTweet({ text });
      if (res.data?.id) { await markStatus(row.id, "published"); postedIds.push(row.id); }
      else { skipped += 1; await markStatus(row.id, "failed"); }
    } catch {
      skipped += 1; await markStatus(row.id, "failed");
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
  try { const body = (await req.json()) as { dry?: boolean }; dry = body?.dry === true; } catch {}
  const result = await runWorker(dry);
  return NextResponse.json(result);
}
