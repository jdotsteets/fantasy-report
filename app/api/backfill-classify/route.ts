// app/api/backfill-classify/route.ts
import { NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { classifyUrl } from "@/lib/contentFilter";   // your existing static detector
import { classifyArticle } from "@/lib/classify";    // your topic classifier

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

type Row = {
  id: number;
  title: string | null;
  cleaned_title: string | null;
  summary: string | null;
  url: string;
  published_at: string | null;
  discovered_at: string | null;
  is_static: boolean | null;
  primary_topic: string | null;
  secondary_topic: string | null;
  topics: string[] | null;
  week: number | null;
  source_name: string | null;
};

type Summary = {
  scanned: number;
  updatedStatic: number;
  updatedTopics: number;
  skipped: number;
  errors: number;
  params: {
    days: number;
    limit: number;
    onlyUndated: boolean;   // only affects static marking
    onlyMissing: boolean;   // only affects topic backfill
    mode: "static" | "topics" | "both";
    dryRun: boolean;
  };
};

export async function POST(req: Request) {
  const url = new URL(req.url);

  // ---- query params ---------------------------------------------------------
  // ?days=365            → look back window for both passes
  // ?limit=500           → max rows to scan (hard max 2000)
  // ?onlyUndated=1       → (static pass) only rows with NULL published_at (default true)
  // ?onlyMissing=1       → (topics pass) only rows with any of (topics, primary, secondary, week) NULL (default true)
  // ?mode=static|topics|both  (default both)
  // ?dryRun=1
  const days        = clampInt(url.searchParams.get("days"), 1, 2000, 365);
  const limit       = clampInt(url.searchParams.get("limit"), 1, 2000, 500);
  const onlyUndated = !isFalsey(url.searchParams.get("onlyUndated")); // default true
  const onlyMissing = !isFalsey(url.searchParams.get("onlyMissing")); // default true
  const dryRun      = isTruthy(url.searchParams.get("dryRun"));
  const modeParam   = (url.searchParams.get("mode") ?? "both").toLowerCase();
  const mode: "static" | "topics" | "both" =
    modeParam === "static" || modeParam === "topics" ? (modeParam as any) : "both";

  // ---- candidate set --------------------------------------------------------
  // One scan, we can decide per-row which passes to run.
  const { rows } = await dbQuery<Row>(
    `
    SELECT
      a.id,
      a.title,
      a.cleaned_title,
      a.summary,
      a.url,
      a.published_at,
      a.discovered_at,
      a.is_static,
      a.primary_topic,
      a.secondary_topic,
      a.topics,
      a.week,
      s.name AS source_name
    FROM articles a
    JOIN sources s ON s.id = a.source_id
    WHERE
      (a.discovered_at >= NOW() - ($1 || ' days')::interval
       OR a.published_at  >= NOW() - ($1 || ' days')::interval)
    ORDER BY (a.published_at IS NULL) DESC, a.discovered_at DESC, a.id DESC
    LIMIT $2
    `,
    [String(days), limit]
  );

  let scanned = 0;
  let updatedStatic = 0;
  let updatedTopics = 0;
  let skipped = 0;
  let errors = 0;

  for (const r of rows) {
    scanned += 1;

    const title = (r.cleaned_title ?? r.title ?? "").trim();
    const wantsStaticPass =
      (mode === "static" || mode === "both") &&
      r.is_static !== true &&
      (!onlyUndated || r.published_at == null);

    const wantsTopicsPass =
      (mode === "topics" || mode === "both") &&
      (!onlyMissing ||
        r.primary_topic == null ||
        r.secondary_topic == null ||
        r.topics == null ||
        r.week == null);

    try {
      // -------- static pass (uses your classifyUrl) --------------------------
      if (wantsStaticPass) {
        const cls = classifyUrl(r.url, title, {
          hasPublishedMeta: r.published_at !== null,
          hasArticleSchema: false,
        });

        if (cls.decision === "include_static") {
          if (!dryRun) {
            await dbQuery(
              `UPDATE articles SET is_static = TRUE
                 WHERE id = $1 AND is_static IS DISTINCT FROM TRUE`,
              [r.id]
            );
          }
          updatedStatic += 1;
        } else {
          skipped += 1;
        }
      }

      // -------- topics pass (uses your classifyArticle) ----------------------
      if (wantsTopicsPass) {
        const c = classifyArticle({
          title,
          summary: r.summary ?? "",
          url: r.url ?? "",
          sourceName: r.source_name ?? "",
          week: r.week,
        });

        // If onlyMissing, we only fill NULLs. Otherwise we overwrite with current logic.
        if (!dryRun) {
          if (onlyMissing) {
            await dbQuery(
              `
              UPDATE articles
              SET
                topics          = COALESCE(topics, $2::text[]),
                primary_topic   = COALESCE(primary_topic, $3::text),
                secondary_topic = COALESCE(secondary_topic, $4::text),
                week            = COALESCE(week, $5::int)
              WHERE id = $1::int
              `,
              [r.id, c.topics.length ? c.topics : null, c.primary, c.secondary, c.week]
            );
          } else {
            await dbQuery(
              `
              UPDATE articles
              SET
                topics          = $2::text[],
                primary_topic   = $3::text,
                secondary_topic = $4::text,
                week            = $5::int
              WHERE id = $1::int
              `,
              [r.id, c.topics.length ? c.topics : null, c.primary, c.secondary, c.week]
            );
          }
        }
        updatedTopics += 1;
      }

      if (!wantsStaticPass && !wantsTopicsPass) skipped += 1;
    } catch {
      errors += 1;
    }
  }

  const summary: Summary = {
    scanned,
    updatedStatic,
    updatedTopics,
    skipped,
    errors,
    params: { days, limit, onlyUndated, onlyMissing, mode, dryRun },
  };

  return NextResponse.json(summary, { status: 200 });
}

/* ───────────────────────── helpers ───────────────────────── */

function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}
function isTruthy(v: string | null): boolean {
  if (!v) return false;
  const s = v.toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}
function isFalsey(v: string | null): boolean {
  if (!v) return false;
  const s = v.toLowerCase();
  return s === "0" || s === "false" || s === "no";
}
