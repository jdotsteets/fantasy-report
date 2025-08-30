// app/api/backfill-images/route.ts
import { dbQuery } from "@/lib/db";
import { findArticleImage } from "@/lib/scrape-image";

export const runtime = "nodejs";         // ensure Node runtime (not edge)
export const dynamic = "force-dynamic";  // NEVER prerender this route
export const revalidate = 0;             // disable caching for the route
export const maxDuration = 60;

type Row = { id: number; url: string; image_url: string | null };

export async function GET(req: Request) {
  // optional auth with the same CRON_SECRET pattern you used elsewhere
  const url = new URL(req.url);
  const key = url.searchParams.get("key") || "";
  const secret = process.env.CRON_SECRET || process.env.ADMIN_TOKEN || "";
  if (secret && key !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }

  const limit = Math.max(1, Math.min(200, parseInt(url.searchParams.get("limit") || "50", 10)));
  const dryRun = url.searchParams.has("dry");

  // pick up rows with null/empty/placeholder images
  const sql = `
    SELECT id, url, image_url
      FROM articles
     WHERE (
            image_url IS NULL
         OR  image_url = ''
         OR  image_url ~ '^(https?://)?(cdn\\.yourdomain\\.com|picsum\\.photos|images\\.unsplash\\.com)'
          )
       AND url IS NOT NULL
     ORDER BY discovered_at DESC NULLS LAST, id DESC
     LIMIT $1
  `;

  try {
    const { rows } = await dbQuery<Row>(sql, [limit]);
    let scanned = 0;
    let updated = 0;
    let skipped = 0;
    const items: Array<{ id: number; url: string; found?: string; reason?: string }> = [];

    for (const r of rows) {
      scanned++;

      // Try to discover a real image from the article page
      let found: string | null = null;
      try {
        found = await findArticleImage(r.url);
      } catch {
        /* non-fatal */
      }

      if (!found) {
        skipped++;
        items.push({ id: r.id, url: r.url, reason: "not-found" });
        continue;
      }

      // If we found something new/different, update it (unless dry run)
      if (!dryRun) {
        await dbQuery(
          `UPDATE articles SET image_url = $1 WHERE id = $2`,
          [found, r.id]
        );
      }

      updated++;
      items.push({ id: r.id, url: r.url, found });
    }

    return new Response(
      JSON.stringify({ ok: true, scanned, updated, skipped, items }, null, 2),
      { headers: { "content-type": "application/json" } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}
