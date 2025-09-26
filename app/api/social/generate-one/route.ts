// app/api/social/generate-one/route.ts
import { NextRequest, NextResponse } from "next/server";
import { dbQuery, dbQueryRows } from "@/lib/db";
import { renderDrafts } from "@/app/src/writing/renderDrafts"; // <- your upgraded renderer
import type { Topic, Platform } from "@/app/src/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 1) Make sure ArticleRow includes what we need
type ArticleRow = {
  id: number;
  title: string | null;
  url: string | null;
  summary: string | null;
  published_at: string | null;   // text/ISO from PG is fine
  domain: string | null;         // fallback for source
  sport: string | null;
  topics: string[] | null;
  source_name?: string | null;   // if you can SELECT it via join to sources
};

type Params = {
  type: "waivers" | "rankings" | "news" | "injuries" | "start-sit" | "mix";
  articleId?: number | null;
};

function parseParams(req: NextRequest): Params {
  const sp = new URL(req.url).searchParams;
  const t = (sp.get("type") ?? "mix") as Params["type"];
  const articleIdStr = sp.get("articleId");
  const articleId =
    articleIdStr && /^\d+$/.test(articleIdStr) ? Number(articleIdStr) : null;
  return { type: t, articleId };
}

/** Basic section → keyword map (tune to your schema/angles) */
function whereForType(p: Params["type"]): string {
  switch (p) {
    case "waivers":
      return `AND (coalesce(a.topics,'{}')::text ILIKE '%waiver%' OR a.title ILIKE '%waiver%')`;
    case "rankings":
      return `AND (coalesce(a.topics,'{}')::text ILIKE '%rank%' OR a.title ILIKE '%ranking%')`;
    case "injuries":
      return `AND (coalesce(a.topics,'{}')::text ILIKE '%injur%' OR a.title ILIKE '%injur%')`;
    case "start-sit":
      return `AND (a.title ILIKE '%start%' OR a.title ILIKE '%sit%' OR coalesce(a.topics,'{}')::text ILIKE '%start%')`;
    case "news":
      return `AND (coalesce(a.topics,'{}')::text ILIKE '%news%')`;
    case "mix":
    default:
      return ``;
  }
}


function toTopic(a: ArticleRow): Topic {
  const src = (a.source_name ?? a.domain ?? "unknown").trim();
  const url = (a.url ?? "").trim();
  const title = (a.title ?? "").trim();
  const publishedAt = a.published_at ?? new Date().toISOString();

  // derive optional fields as undefined (not null)
  const angle = a.summary?.trim() || undefined;
  const stat = undefined as string | undefined; // or compute if you have one

  return {
    id: String(a.id),
    title,
    url,
    source: src,
    publishedAt,

    // optional fields (only include when defined)
    ...(a.sport ? { sport: a.sport } : {}),
    ...(angle ? { angle } : {}),
    ...(stat ? { stat } : {}),

    // if you don't have these, omit them instead of null
    // (remove spreads below if you actually have values)
    // primaryTopic/staticType/week/isPlayerPage can also be omitted
    // to keep the payload minimal and satisfy stricter Topic variations.
  };
}

/** Pick the newest eligible article unless a specific one is requested */
async function pickArticle(params: Params): Promise<ArticleRow | null> {
  if (params.articleId) {
    const rows = await dbQueryRows<ArticleRow>(
      `
      SELECT a.id, a.title, a.url, a.summary, a.published_at, a.domain, a.sport, a.topics
        FROM articles a
       WHERE a.id = $1
       LIMIT 1
      `,
      [params.articleId]
    );
    return rows[0] ?? null;
  }

  // Fresh, NFL-ish, not recently drafted on X in last 7 days
  const rows = await dbQueryRows<ArticleRow>(
    `
    WITH recently_drafted AS (
      SELECT DISTINCT d.article_id
        FROM social_drafts d
       WHERE d.platform = 'x'
         AND d.created_at >= now() - interval '7 days'
    )
    SELECT a.id, a.title, a.url, a.summary, a.published_at, a.domain, a.sport, a.topics
      FROM articles a
     WHERE a.url IS NOT NULL
       AND (a.sport IS NULL OR a.sport ILIKE 'nfl')
       AND a.published_at >= now() - interval '7 days'
       AND NOT EXISTS (
             SELECT 1 FROM recently_drafted r WHERE r.article_id = a.id
           )
       ${whereForType(params.type)}
  ORDER BY a.published_at DESC NULLS LAST, a.id DESC
     LIMIT 1
    `
  );

  return rows[0] ?? null;
}

async function insertDraftFromTopic(topic: Topic, platform: Platform = "x"): Promise<number> {
  // Generate exactly one variant for exactly one platform
  const drafts = await renderDrafts([topic], { platforms: [platform], variantsPerTopic: 1 });
  const d = drafts[0];

  // Persist to social_drafts (fields inferred from your worker & view)
  const row = await dbQueryRows<{ id: number }>(
    `
    INSERT INTO social_drafts
      (article_id, platform, status, hook, body, cta, scheduled_for)
    VALUES
      ($1, $2, 'draft', $3, $4, $5, NULL)
    RETURNING id
    `,
    [Number(topic.id), platform, d.hook, d.body, d.cta ?? null]
  );

  return row[0].id;
}

export async function POST(req: NextRequest) {
  const params = parseParams(req);

  // 1) choose article
  const article = await pickArticle(params);
  if (!article || !article.id || !article.url || !article.title) {
    return NextResponse.json(
      { ok: false, error: "No eligible article found for this type." },
      { status: 404 }
    );
  }

  // 2) render & insert one draft
  const topic = toTopic(article);
  const id = await insertDraftFromTopic(topic, "x");

  return NextResponse.json({ ok: true, id });
}

export async function GET(req: NextRequest) {
  // convenience for manual testing
  return POST(req);
}
