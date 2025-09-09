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
    .map((p) => p[0]?.toUpperCase() + p.slice(1))
    .join(" ");
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const days = Math.max(1, Math.min(Number(url.searchParams.get("days") || 60), 365));
  const limitPlayers = Math.max(1, Math.min(Number(url.searchParams.get("limit") || 500), 5000));

  // Pull keys from articles.players (array) over the time window, keep the most recent sighting
  const { rows } = await dbQuery<{
    key: string;
    last_seen: string;
  }>(
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
      -- normalize keys so both 'nfl:name:slug' and 'slug' collapse together
      REGEXP_REPLACE(raw_key, '^nfl:name:', '') AS key,
      MAX(ts) AS last_seen
    FROM seen
    GROUP BY 1
    ORDER BY MAX(ts) DESC
    LIMIT $2
    `,
    [String(days), limitPlayers]
  );

  // Optional: pull per-site player links if you keep them
  // Expected schema: player_links(key text PRIMARY KEY, domain text, url text)
  // It's OK if you don't have this table—returns 0 rows.
  const linksRes = await dbQuery<{ key: string; domain: string; url: string }>(`
    SELECT REGEXP_REPLACE(key, '^nfl:name:', '') AS key, domain, url
    FROM player_links
  `).catch(() => ({ rows: [] as any[] }));

  const linkMap = new Map<string, Record<string, string>>();
  for (const r of linksRes.rows) {
    const k = r.key;
    if (!linkMap.has(k)) linkMap.set(k, {});
    linkMap.get(k)![r.domain] = r.url;
  }

  // Collect distinct domains we know how to link to (table-driven)
  const domains = Array.from(
    new Set(linksRes.rows.map((r) => r.domain))
  ).sort();

  const players = rows.map((r) => {
    const key = normKey(r.key)!;
    return {
      key,
      name: displayNameFromKey(key),
      links: linkMap.get(key) ?? {},
      lastSeen: r.last_seen,
    };
  });

  return NextResponse.json({ players, domains }, { status: 200 });
}
