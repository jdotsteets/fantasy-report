// app/api/articles/[slug]/route.ts
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: { slug: string } };

export async function GET(_req: Request, ctx: Ctx) {
  const slug = ctx.params?.slug;
  if (!slug) return new Response("Not found", { status: 404 });

  const { rows } = await query(
    `select
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
     limit 1`,
    [slug]
  );

  if (rows.length === 0) return new Response("Not found", { status: 404 });

  return new Response(JSON.stringify(rows[0]), {
    headers: { "content-type": "application/json" }
  });
}
