// app/api/backfill-classify/route.ts
import { NextRequest } from "next/server";
import { dbQuery } from "@/lib/db";
import { classifyArticle } from "@/lib/classify";

export const runtime = "nodejs";         // ensure Node runtime (not edge)
export const dynamic = "force-dynamic";  // NEVER prerender this route
export const revalidate = 0;             // disable caching for the route

export const maxDuration = 60;

/** Section tags we control (and legacy aliases we want to strip). */
const SECTION_TAGS = new Set([
  "waiver", "waiver-wire",
  "rankings",
  "start_sit", "start-sit",
  "injury",
  "dfs",
  "advice",
  "news",   // legacy / not used as a topic anymore
  "trade",  // legacy; mapped into advice already
]);

/** Normalize legacy aliases to canonical section slugs used across the app. */
function normalizeSectionTag(t: string): string {
  const k = t.toLowerCase();
  if (k === "waiver") return "waiver-wire";
  if (k === "start_sit") return "start-sit";
  return k;
}

type Row = {
  id: number;
  title: string | null;           // coalesced cleaned_title/title (we still select url fields separately)
  url: string | null;
  canonical_url: string | null;
  week: number | null;
  source: string;                 // sources.name
  topics: string[] | null;        // existing topics array
  primary_topic: string | null;   // existing primary
  secondary_topic: string | null; // existing secondary (nullable)
};

// GET /api/backfill-classify?key=CRON_SECRET&batch=500&fromId=0&dryRun=1&debug=1
export async function GET(req: NextRequest) {
  const url = new URL(req.url);

  // --- AUTH (same approach as ingest) ---
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
  const batch = Math.max(50, Math.min(1000, Number.isFinite(batchRaw) ? batchRaw : 500));

  const fromIdRaw = Number(url.searchParams.get("fromId") ?? 0);
  let cursor = Number.isFinite(fromIdRaw) ? fromIdRaw : 0; // id > cursor

  let processed = 0;
  let updated = 0;
  const stats: Array<{
    id: number;
    beforeTopics?: string[] | null;
    beforePrimary?: string | null;
    beforeSecondary?: string | null;
    afterTopics?: string[];
    afterPrimary?: string | null;
    afterSecondary?: string | null;
  }> = [];

  while (true) {
    // Keyset-pagination by id
    const { rows } = await dbQuery<Row>(
      `
      SELECT
        a.id,
        COALESCE(a.cleaned_title, a.title) AS title,
        a.url,
        a.canonical_url,
        a.week,
        s.name AS source,
        a.topics,
        a.primary_topic,
        a.secondary_topic
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
      cursor = r.id;

      const title = (r.title ?? "").trim();
      // Augment the classify text with URL bits so URL keywords (sleeper, waiver, start/sit, etc.) are considered.
      // This works even if classifyArticle's Input type doesn't expose url fields.
      const augmentedTitle =
        [title, r.canonical_url ?? "", r.url ?? ""].filter(Boolean).join("\n");

      // NEW classifier shape (primary/secondary/topics/week)
      const { primary, secondary, topics: freshTopics, week } = classifyArticle({
        title: augmentedTitle,
        summary: null,
        sourceName: r.source,
        week: r.week,
      });

      // Merge topics:
      // 1) start from existing
      const existing = Array.isArray(r.topics) ? r.topics : [];

      // 2) strip any section tags (old or new) so we re-add cleanly
      const preserved = existing
        .map(normalizeSectionTag)
        .filter((t) => !SECTION_TAGS.has(t));

      // 3) include classifier's topics (already canonical, but normalize anyway)
      const normalizedFresh = (freshTopics ?? []).map(normalizeSectionTag);

      // 4) re-add canonical primary/secondary tags (if present)
      const toAdd: string[] = [];
      if (primary) toAdd.push(primary);
      if (secondary && secondary !== primary) toAdd.push(secondary);

      const mergedSet = new Set<string>([...preserved, ...normalizedFresh, ...toAdd]);
      const merged = Array.from(mergedSet);

      // Decide if anything changed (topics / primary / secondary / week)
      const beforeSet = new Set(existing.map(normalizeSectionTag));
      const topicsChanged =
        merged.length !== beforeSet.size ||
        merged.some((t) => !beforeSet.has(t)) ||
        [...beforeSet].some((t) => !mergedSet.has(t));

      const primaryChanged = (r.primary_topic ?? null) !== (primary ?? null);
      const secondaryChanged = (r.secondary_topic ?? null) !== (secondary ?? null);

      if ((topicsChanged || primaryChanged || secondaryChanged) && !dryRun) {
        await dbQuery(
          `UPDATE articles
           SET topics = $1,
               primary_topic = $2,
               secondary_topic = $3,
               week = COALESCE(week, $4) -- keep existing week; fill if classifier extracted one
           WHERE id = $5`,
          [merged, primary ?? null, secondary ?? null, week ?? null, r.id]
        );
        updated++;
      } else if ((topicsChanged || primaryChanged || secondaryChanged) && dryRun) {
        updated++; // count how many *would* change
      }

      if (debug) {
        stats.push({
          id: r.id,
          beforeTopics: r.topics,
          beforePrimary: r.primary_topic,
          beforeSecondary: r.secondary_topic,
          afterTopics: merged,
          afterPrimary: primary ?? null,
          afterSecondary: secondary ?? null,
        });
      }
    }

    if (rows.length < batch) break; // end
  }

  return new Response(
    JSON.stringify(
      { ok: true, processed, updated, dryRun, ...(debug ? { stats } : {}) },
      null,
      2
    ),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}
