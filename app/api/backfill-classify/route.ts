// app/api/backfill-classify/route.ts
import { NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { classifyUrl } from "@/lib/contentFilter";

export const dynamic = "force-dynamic";

type Row = {
  id: number;
  title: string | null;
  url: string;
  published_at: string | null;
  discovered_at: string | null;
  is_static: boolean | null;
};

type Summary = {
  scanned: number;
  updated: number;
  skipped: number;
  errors: number;
  params: {
    days: number;
    limit: number;
    onlyUndated: boolean;
    dryRun: boolean;
  };
};

export async function POST(req: Request) {
  // Query flags (all optional):
  //   ?days=180        → look back this many days (default 365)
  //   ?limit=500       → max rows to scan (default 500; hard max 2000)
  //   ?onlyUndated=0   → include dated rows too (default true = only undated)
  //   ?dryRun=1        → do not write, just report (default false)
  const url = new URL(req.url);
  const days = clampInt(url.searchParams.get("days"), 1, 2000, 365);
  const limit = clampInt(url.searchParams.get("limit"), 1, 2000, 500);
  const onlyUndated = !isFalsey(url.searchParams.get("onlyUndated")); // default true
  const dryRun = isTruthy(url.searchParams.get("dryRun"));

  // Build candidate set: recent, non-static; prefer undated unless onlyUndated=0
  const dateFilter = onlyUndated ? "AND a.published_at IS NULL" : "";
  const { rows } = await dbQuery<Row>(
    `
    SELECT
      a.id,
      COALESCE(a.cleaned_title, a.title) AS title,
      a.url,
      a.published_at,
      a.discovered_at,
      a.is_static
    FROM articles a
    WHERE
      a.is_static IS NOT TRUE
      AND a.discovered_at >= NOW() - ($1 || ' days')::interval
      ${dateFilter}
    ORDER BY (a.published_at IS NULL) DESC, a.discovered_at DESC, a.id DESC
    LIMIT $2
    `,
    [String(days), limit]
  );

  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const r of rows) {
    scanned += 1;

    try {
      const cls = classifyUrl(r.url, r.title, {
        hasPublishedMeta: r.published_at !== null,
        hasArticleSchema: false,
      });

      if (cls.decision !== "include_static") {
        skipped += 1;
        continue;
      }

      // Mark as static (idempotent); stickiness is handled in your upsert, but we
      // also guard here to avoid needless writes.
      if (!dryRun) {
        await dbQuery(
          `UPDATE articles SET is_static = TRUE WHERE id = $1 AND is_static IS DISTINCT FROM TRUE`,
          [r.id]
        );
      }
      updated += 1;
    } catch {
      errors += 1;
    }
  }

  const summary: Summary = {
    scanned,
    updated,
    skipped,
    errors,
    params: { days, limit, onlyUndated, dryRun },
  };

  return NextResponse.json(summary, { status: 200 });
}

/* ───────────────────────── helpers ───────────────────────── */

function clampInt(
  raw: string | null,
  min: number,
  max: number,
  fallback: number
): number {
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
