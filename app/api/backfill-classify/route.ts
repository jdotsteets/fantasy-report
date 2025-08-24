import { NextRequest } from "next/server";
import { dbQuery } from "@/lib/db";
import { classifyArticle } from "@/lib/classify";

export const runtime = "nodejs";
export const maxDuration = 60;

// Known top-level category tags we manage via classification
const CATEGORY_TAGS = new Set([
  "waiver",
  "rankings",
  "start_sit",
  "trade",
  "injury",
  "dfs",
  "news",
  "advice",
]);

type Row = {
  id: number;
  title: string | null;         // coalesced cleaned_title/title
  week: number | null;
  source: string;               // sources.name
  topics: string[] | null;      // existing topics
};

// GET /api/backfill-classify?key=CRON_SECRET&batch=500&fromId=0&dryRun=1&debug=1
export async function GET(req: NextRequest) {
  const url = new URL(req.url);

  // --- AUTH (same style as ingest) ---
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization") || "";
  const urlKey = url.searchParams.get("key") || "";
  if (secret && authHeader !== `Bearer ${secret}` && urlKey !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }

  // --- Controls ---
  const dryRun = url.searchParams.get("dryRun") === "1";
  const debug = url.searchParams.get("debug") === "1";

  const batchRaw = Number(url.searchParams.get("batch") ?? 500);
  const batch = Math.max(50, Math.min(1000, isFinite(batchRaw) ? batchRaw : 500));

  const fromIdRaw = Number(url.searchParams.get("fromId") ?? 0);
  let cursor = Number.isFinite(fromIdRaw) ? fromIdRaw : 0; // id > cursor

  let processed = 0;
  let updated = 0;
  const stats: Array<{ id: number; before?: string[] | null; after?: string[] }> = [];

  while (true) {
    // Keyset-pagination by id
    const { rows } = await dbQuery<Row>(
      `
      SELECT
        a.id,
        COALESCE(a.cleaned_title, a.title) AS title,
        a.week,
        s.name AS source,
        a.topics
      FROM articles a
      JOIN sources s ON s.id = a.source_id
      WHERE a.id > $1
      ORDER BY a.id
      LIMIT $2
      `,
      [cursor, batch]
    );

    if (rows.length === 0) break;

    for (const r of rows) {
      processed++;
      cursor = r.id; // advance key

      const title = (r.title ?? "").trim();
      // We don't have a stored summary/body; classification will still work on titles.
      const { topics: newTopics } = classifyArticle({
        title,
        summary: null,
        sourceName: r.source,
        week: r.week,
      });

      // Merge with existing non-category tags; drop old category tags first
      const existing = Array.isArray(r.topics) ? r.topics : [];
      const preserved = existing.filter((t) => !CATEGORY_TAGS.has(t));
      const merged = Array.from(new Set<string>([...preserved, ...newTopics]));

      // Skip DB write if unchanged
      const unchanged =
        existing.length === merged.length &&
        existing.every((t) => merged.includes(t));

      if (!unchanged && !dryRun) {
        await dbQuery(`UPDATE articles SET topics = $1 WHERE id = $2`, [merged, r.id]);
        updated++;
      } else if (!unchanged && dryRun) {
        updated++; // report how many *would* update
      }

      if (debug) {
        stats.push({
          id: r.id,
          before: existing,
          after: merged,
        });
      }
    }

    // If we fetched less than batch, we reached the end.
    if (rows.length < batch) break;
  }

  return new Response(
    JSON.stringify(
      {
        ok: true,
        processed,
        updated,
        dryRun,
        ...(debug ? { stats } : {}),
      },
      null,
      2
    ),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}
