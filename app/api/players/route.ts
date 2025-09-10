//app/api/players/route.ts

import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normKey(k: string | null): string | null {
  if (!k) return null;
  return k.startsWith("nfl:name:") ? k.slice("nfl:name:".length) : k;
}
function displayNameFromKey(k: string): string {
  // "justin-jefferson" -> "Justin Jefferson"
  return k
    .split("-")
    .filter(Boolean)
    .map((p) => (p[0] ? p[0].toUpperCase() : "") + p.slice(1))
    .join(" ");
}

/* ───────── helpers to normalize dbQuery shapes ───────── */
type ResultLike<T> = T[] | { rows?: T[] };
function toRows<T>(res: unknown): T[] {
  const v = res as ResultLike<T>;
  if (Array.isArray(v)) return v;
  return Array.isArray(v.rows) ? v.rows : [];
}

/* ───────── row types ───────── */
type SeenRow = {
  key: string;
  last_seen: string;
};
type LinkRow = {
  key: string;
  domain: string;
  url: string;
};
type PlayerOut = {
  key: string;
  name: string;
  links: Record<string, string>;
  lastSeen: string;
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const days = Math.max(1, Math.min(Number(url.searchParams.get("days") ?? 60), 365));
  const limitPlayers = Math.max(1, Math.min(Number(url.searchParams.get("limit") ?? 500), 5000));

  // Pull keys from articles.players (array) over the time window, keep the most recent sighting
  const seenRes = await dbQuery<SeenRow>(
    `
    WITH seen AS (
      SELECT
        unnest(players) AS raw_key,
        COALESCE(published_at, discovered_at) AS ts
      FROM articles
      WHERE players IS NOT NULL
        AND array_length(players, 1) > 0
        AND COALESCE(published_at, discovered_at) >= NOW() - ($1 || ' days')::interval
    )
    SELECT
      REGEXP_REPLACE(raw_key, '^nfl:name:', '') AS key,
      MAX(ts) AS last_seen
    FROM seen
    GROUP BY 1
    ORDER BY MAX(ts) DESC
    LIMIT $2
    `,
    [String(days), limitPlayers]
  );
  const seenRows = toRows<SeenRow>(seenRes);

  // Optional: per-site player links (if the table exists)
  let linkRows: LinkRow[] = [];
  try {
    const lr = await dbQuery<LinkRow>(`
      SELECT REGEXP_REPLACE(key, '^nfl:name:', '') AS key, domain, url
      FROM player_links
    `);
    linkRows = toRows<LinkRow>(lr);
  } catch {
    linkRows = [];
  }

  // Build map: player key -> { domain: url, ... }
  const linkMap = new Map<string, Record<string, string>>();
  for (const r of linkRows) {
    const existing = linkMap.get(r.key) ?? {};
    existing[r.domain] = r.url;
    linkMap.set(r.key, existing);
  }

  // Collect distinct domains we know how to link to (table-driven)
  const domains = Array.from(new Set(linkRows.map((r) => r.domain))).sort();

  const players: PlayerOut[] = seenRows.map((r) => {
    const normalized = normKey(r.key) ?? r.key;
    return {
      key: normalized,
      name: displayNameFromKey(normalized),
      links: linkMap.get(normalized) ?? {},
      lastSeen: r.last_seen,
    };
  });

  return NextResponse.json({ players, domains }, { status: 200 });
}
