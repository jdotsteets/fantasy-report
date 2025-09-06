// app/api/backfill-classify/route.ts
import { NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { classifyUrl } from "@/lib/contentFilter";
import { classifyArticle } from "@/lib/classify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;
export const maxDuration = 60;

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

type MissingKind = "all" | "primary" | "secondary" | "topics" | "week";

type Summary = {
  ok: true;
  scanned: number;
  changedStatic: number;
  changedTopics: number;
  skipped: number;
  errors: number;
  remainingMissing: number;
  errorSamples?: { id: string; message: string }[];
  params: {
    days: number;
    limit: number;
    onlyUndated: boolean;
    onlyMissing: boolean;
    mode: "static" | "topics" | "both";
    dryRun: boolean;
    missing: MissingKind;
  };
};

export async function POST(req: Request) {
  const url = new URL(req.url);

  const days        = clampInt(url.searchParams.get("days"), 1, 2000, 365);
  const limit       = clampInt(url.searchParams.get("limit"), 1, 2000, 500);
  const onlyUndated = !isFalsey(url.searchParams.get("onlyUndated"));
  const onlyMissing = !isFalsey(url.searchParams.get("onlyMissing"));
  const dryRun      = isTruthy(url.searchParams.get("dryRun"));
  const modeParam   = (url.searchParams.get("mode") ?? "both").toLowerCase();
  const mode: "static" | "topics" | "both" =
    modeParam === "static" || modeParam === "topics" ? (modeParam as any) : "both";

  const missingParam = (url.searchParams.get("missing") ?? "all").toLowerCase();
  const missing: MissingKind =
    missingParam === "primary" || missingParam === "secondary" ||
    missingParam === "topics"  || missingParam === "week"
      ? (missingParam as MissingKind)
      : "all";

  const missingClause = (() => {
    switch (missing) {
      case "primary":   return "a.primary_topic   IS NULL";
      case "secondary": return "a.secondary_topic IS NULL";
      case "topics":    return "(a.topics IS NULL OR cardinality(a.topics) = 0)";
      case "week":      return "a.week IS NULL";
      default:          return `
          a.primary_topic   IS NULL
          OR a.secondary_topic IS NULL
          OR a.topics          IS NULL
          OR cardinality(a.topics) = 0
          OR a.week            IS NULL
        `;
    }
  })();

  const { rows } = await dbQuery<Row>(
    `
    SELECT
      a.id, a.title, a.cleaned_title, a.summary, a.url,
      a.published_at, a.discovered_at, a.is_static,
      a.primary_topic, a.secondary_topic, a.topics, a.week,
      s.name AS source_name
    FROM articles a
    JOIN sources s ON s.id = a.source_id
    WHERE
      (
        a.discovered_at >= NOW() - ($1::text || ' days')::interval
        OR a.published_at >= NOW() - ($1::text || ' days')::interval
      )
      AND (
        NOT $3::boolean
        OR (${missingClause})
      )
    ORDER BY (a.published_at IS NULL) DESC, a.discovered_at DESC, a.id DESC
    LIMIT $2::int
    `,
    [String(days), limit, onlyMissing]
  );

  let scanned = 0;
  let changedStatic = 0;
  let changedTopics = 0;
  let skipped = 0;
  let errors = 0;
  const errorSamples: { id: string; message: string }[] = [];

  for (const r of rows) {
    scanned += 1;

    const title = (r.cleaned_title ?? r.title ?? "").trim();

    const wantsStaticPass =
      (mode === "static" || mode === "both") &&
      r.is_static !== true &&
      (!onlyUndated || r.published_at == null);

    const wantsTopicsPass =
      (mode === "topics" || mode === "both") &&
      (!onlyMissing || needsTopics(r, missing));

    try {
      if (wantsStaticPass) {
        const cls = classifyUrl(r.url, title, {
          hasPublishedMeta: r.published_at !== null,
          hasArticleSchema: false,
        });

        if (cls.decision === "include_static") {
          if (!dryRun) {
            const { rowCount } = await dbQuery(
              `UPDATE articles
                 SET is_static = TRUE
               WHERE id = $1::int
                 AND is_static IS DISTINCT FROM TRUE`,
              [r.id]
            );
            if (rowCount && rowCount > 0) changedStatic += rowCount;
          } else {
            changedStatic += 1;
          }
        } else {
          skipped += 1;
        }
      }

      if (wantsTopicsPass) {
        const c = classifyArticle({
          title,
          summary: r.summary ?? "",
          url: r.url ?? "",
          sourceName: r.source_name ?? "",
          week: r.week,
        });

        const topicsNorm = normalizeTopics(c.topics);
        const newTopics = topicsNorm.length ? topicsNorm : null; // may be NULL
        const newPrimary = (c.primary ?? "") || null;            // NULL when unknown
        const newSecondary = (c.secondary ?? "") || null;        // NULL when unknown
        const newWeek = c.week ?? null;                           // may be NULL

        if (!dryRun) {
          if (onlyMissing) {
            // Fill NULLs only (cast every placeholder; cast $6 too)
            const { rowCount } = await dbQuery(
              `
              UPDATE articles
                 SET topics =
                       CASE
                         WHEN (topics IS NULL OR cardinality(topics) = 0)
                           THEN $2::text[]
                         ELSE topics
                       END,
                     primary_topic   = COALESCE(primary_topic, $3::text),
                     secondary_topic = COALESCE(secondary_topic, $4::text),
                     week            = COALESCE(week, $5::int)
               WHERE id = $1::int
                 AND (
                      ( ($6::text = 'topics'    AND (topics IS NULL OR cardinality(topics)=0)) )
                   OR ( ($6::text = 'primary'   AND primary_topic   IS NULL) )
                   OR ( ($6::text = 'secondary' AND secondary_topic IS NULL) )
                   OR ( ($6::text = 'week'      AND week            IS NULL) )
                   OR ( $6::text = 'all' AND (
                          ((topics IS NULL OR cardinality(topics)=0) AND $2::text[] IS NOT NULL)
                       OR (primary_topic   IS NULL AND $3::text IS NOT NULL)
                       OR (secondary_topic IS NULL AND $4::text IS NOT NULL)
                       OR (week            IS NULL AND $5::int  IS NOT NULL)
                     ))
                 )
              `,
              [r.id, newTopics, newPrimary, newSecondary, newWeek, missing]
            );
            if (rowCount && rowCount > 0) changedTopics += rowCount;
            else skipped += 1;
          } else {
            // Overwrite when changed (cast on both sides in WHERE)
            const { rowCount } = await dbQuery(
              `
              UPDATE articles
                 SET topics          = $2::text[],
                     primary_topic   = $3::text,
                     secondary_topic = $4::text,
                     week            = $5::int
               WHERE id = $1::int
                 AND (
                      COALESCE(topics, '{}'::text[]) IS DISTINCT FROM COALESCE($2::text[], '{}'::text[])
                   OR primary_topic                   IS DISTINCT FROM $3::text
                   OR secondary_topic                 IS DISTINCT FROM $4::text
                   OR week                            IS DISTINCT FROM $5::int
                 )
              `,
              [r.id, newTopics, newPrimary, newSecondary, newWeek]
            );
            if (rowCount && rowCount > 0) changedTopics += rowCount;
            else skipped += 1;
          }
        } else {
          if (needsTopics(r, missing)) changedTopics += 1;
        }
      }

      if (!wantsStaticPass && !wantsTopicsPass) skipped += 1;
    } catch (e: any) {
      errors += 1;
      if (errorSamples.length < 12) {
        errorSamples.push({ id: String(r.id), message: String(e?.message ?? e) });
      }
    }
  }

  // Global remaining count using same "missing" lens
  const { rows: remainingRows } = await dbQuery<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM articles a WHERE ${missingClause}`
  );

  const summary: Summary = {
    ok: true,
    scanned,
    changedStatic,
    changedTopics,
    skipped,
    errors,
    remainingMissing: remainingRows[0]?.count ?? 0,
    errorSamples: errorSamples.length ? errorSamples : undefined,
    params: { days, limit, onlyUndated, onlyMissing, mode, dryRun, missing },
  };

    return NextResponse.json(
      {
        ...summary,
        updatedTopics: summary.changedTopics,
        updatedStatic: summary.changedStatic,
      },
      { status: 200 }
    );
}
/* ───────── helpers ───────── */

function needsTopics(r: Row, missing: MissingKind): boolean {
  switch (missing) {
    case "primary":   return r.primary_topic == null;
    case "secondary": return r.secondary_topic == null;
    case "topics":    return r.topics == null || (Array.isArray(r.topics) && r.topics.length === 0);
    case "week":      return r.week == null;
    default:
      return (
        r.primary_topic == null ||
        r.secondary_topic == null ||
        r.topics == null ||
        (Array.isArray(r.topics) && r.topics.length === 0) ||
        r.week == null
      );
  }
}

function normalizeTopics(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out = new Set<string>();
  for (const x of list) {
    if (typeof x !== "string") continue;
    const v = x.trim();
    if (!v) continue;
    out.add(v);
  }
  return Array.from(out);
}

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
