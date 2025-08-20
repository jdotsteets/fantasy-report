// app/api/articles/[slug]/route.ts
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ArticleRow = {
  id: number;
  title: string;
  url: string;
  canonical_url: string | null;
  domain: string | null;
  published_at: string | null;
  week: number | null;
  topics: string[] | null;
  source: string;
};

function readSlug(ctx: unknown): string | null {
  try {
    const slug = (ctx as { params?: { slug?: string } })?.params?.slug;
    return typeof slug === "string" && slug.length > 0 ? slug : null;
  } catch {
    return null;
  }
}

/** @ts-expect-error Next.js wants the 2nd param untyped; we narrow inside */
export async function GET(_req: Request, ctx) {
  const slug = readSlug(ctx);
  if (!slug) {
    return new Response("Missing slug", { status: 400 });
  }

  const { rows } = await query(
    `
      select
        a.id,
        coalesce(a.cleaned_title, a.title) as title,
        a.url,
        a.canonical_url,
        a.domain,
        a.published_at,
        a.week,
        a.topics,
        s.name as source
      from articles a
      join sources s on s.id = a.source_id
      where a.slug = $1
      limit 1
    `,
    [slug]
  );

  if (rows.length === 0) {
    return new Response("Not found", { status: 404 });
  }

  const item = rows[0] as ArticleRow;

  return new Response(JSON.stringify(item), {
    headers: { "content-type": "application/json" },
  });
}
