import { query } from "@/lib/db";
import { isWeakArticleImage, extractLikelyNameFromTitle } from "@/lib/images";
import { findWikipediaHeadshot } from "@/lib/wiki";
import { cacheRemoteImageToSupabase } from "@/lib/upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = { slug?: string };

// Next 15 sometimes provides `params` as a thenable; handle both cases.
async function readSlug(ctx: unknown): Promise<string | null> {
  try {
    const maybeParams = (ctx as { params?: unknown })?.params as
      | RouteParams
      | Promise<RouteParams>
      | undefined;

    const params =
      maybeParams && typeof (maybeParams as Promise<unknown>).then === "function"
        ? await (maybeParams as Promise<RouteParams>)
        : (maybeParams as RouteParams | undefined);

    const slug = params?.slug;
    return typeof slug === "string" && slug.length > 0 ? slug : null;
  } catch {
    return null;
  }
}

export async function POST(req: Request, ctx: unknown) {
  const slug = await readSlug(ctx);
  if (!slug) return new Response("Missing slug", { status: 400 });

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";

  // accept either /[slug]/... or /[id]/...
  const idNum = Number(slug);
  const idForQuery = Number.isFinite(idNum) ? idNum : -1;

  // 1) load article by slug OR id
  const { rows } = await query<{
    id: number;
    title: string;
    image_url: string | null;
  }>(
    `
      select a.id, coalesce(a.cleaned_title, a.title) as title, a.image_url
        from articles a
       where a.slug = $1 or a.id = $2
       limit 1
    `,
    [slug, idForQuery]
  );

  const a = rows[0];
  if (!a) return new Response("Not found", { status: 404 });

  if (!force && !isWeakArticleImage(a.image_url)) {
    return json({ updated: false, reason: "existing image ok", id: a.id });
  }

  // 2) infer a player/person name from the title
  const name = extractLikelyNameFromTitle(a.title);
  if (!name) return json({ updated: false, reason: "no name found", id: a.id });

  // 3) search Wikimedia for a usable headshot
  const hit = await findWikipediaHeadshot(name);
  if (!hit) return json({ updated: false, reason: "no wiki image", id: a.id, name });

  // 4) cache to your bucket/CDN and update DB
  const publicUrl = await cacheRemoteImageToSupabase(hit.src, `articles/${a.id}.jpg`);
  await query(`update articles set image_url = $1 where id = $2`, [publicUrl, a.id]);

  return json({ updated: true, id: a.id, name, image_url: publicUrl });
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}
