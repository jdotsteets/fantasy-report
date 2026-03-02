// app/api/backfill-players/route.ts
import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { extractPlayersFromTitleAndUrl } from "@/lib/images";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Row = {
  id: number;
  title: string | null;
  url: string | null;
  players: string[] | null;
};

function bearer(req: NextRequest): string | null {
  const h = req.headers.get("authorization");
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}

function parseLimit(v: string | null): number {
  const n = Number(v ?? "");
  // allow up to 2000 per call, default 500
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), 2000) : 500;
}
function parseBool(v: string | null): boolean {
  if (!v) return false;
  return ["1", "true", "yes", "y"].includes(v.toLowerCase());
}

async function handle(req: NextRequest) {
  // Optional auth with CRON_SECRET/ADMIN_TOKEN
  const url = new URL(req.url);
  const token = bearer(req) ?? url.searchParams.get("key") ?? "";
  const secret = process.env.CRON_SECRET || process.env.ADMIN_TOKEN || process.env.ADMIN_KEY || "";
  if (secret && token !== secret) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const limit = parseLimit(url.searchParams.get("limit"));
  const dryRun = parseBool(url.searchParams.get("dry"));
  const overwrite = parseBool(url.searchParams.get("overwrite")); // overwrite existing players if true

  // choose predicate: only-null/empty unless overwrite=true
  const where = overwrite
    ? `url IS NOT NULL` // scan newest first, regardless of existing players
    : `(players IS NULL OR array_length(players,1) IS NULL) AND url IS NOT NULL`;

  const selectSql = `
    SELECT id, title, url, players
    FROM articles
    WHERE ${where}
    ORDER BY COALESCE(published_at, discovered_at) DESC NULLS LAST, id DESC
    LIMIT $1
  `;

  const { rows } = await dbQuery<Row>(selectSql, [limit]);

  let scanned = 0;
  let updated = 0;
  let unchanged = 0;
  const items: Array<{
    id: number;
    found?: string[];
    prev?: string[] | null;
    action: "updated" | "unchanged" | "skipped";
  }> = [];

  for (const r of rows) {
    scanned++;
    const found = extractPlayersFromTitleAndUrl(r.title ?? null, r.url ?? null) ?? [];

    // If nothing found, skip quietly
    if (found.length === 0) {
      items.push({ id: r.id, action: "skipped" });
      continue;
    }

    // De-dup + stable order
    const unique = Array.from(new Set(found));

    // If not overwriting and there are already players, only update when different/empty
    const prev = r.players ?? null;
    const same =
      Array.isArray(prev) &&
      prev.length === unique.length &&
      prev.every((p, i) => p === unique[i]); // expecting our extractor to be deterministic

    if (!overwrite && same) {
      unchanged++;
      items.push({ id: r.id, action: "unchanged", prev, found: unique });
      continue;
    }

    if (!dryRun) {
      await dbQuery(`UPDATE articles SET players = $1 WHERE id = $2`, [unique, r.id]);
    }
    updated++;
    items.push({ id: r.id, action: "updated", prev, found: unique });
  }

  return NextResponse.json({
    ok: true,
    scanned,
    updated,
    unchanged,
    dryRun,
    overwrite,
    limit,
    items,
  });
}

// Accept both GET and POST for convenience
export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}
