import PlayerMatrix from "@/components/players/PlayerMatrix";
import { dbQuery } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function PlayersPage() {
  // Reuse the API logic directly to avoid client waterfalls
  const days = 60;
  const limit = 500;

  // Same SQL as the /api/players route, condensed for server usage
  const playersSql = `
    WITH seen AS (
      SELECT unnest(players) AS raw_key,
             COALESCE(published_at, discovered_at) AS ts
      FROM articles
      WHERE players IS NOT NULL
        AND array_length(players, 1) > 0
        AND COALESCE(published_at, discovered_at) >= NOW() - ($1 || ' days')::interval
    )
    SELECT REGEXP_REPLACE(raw_key, '^nfl:name:', '') AS key, MAX(ts) AS last_seen
    FROM seen
    GROUP BY 1
    ORDER BY MAX(ts) DESC
    LIMIT $2
  `;
  const rows = (await dbQuery<{ key: string; last_seen: string }>(playersSql, [
    String(days),
    limit,
  ])).rows;

  const links = await dbQuery<{ key: string; domain: string; url: string }>(`
    SELECT REGEXP_REPLACE(key, '^nfl:name:', '') AS key, domain, url
    FROM player_links
  `).catch(() => ({ rows: [] as any[] }));

  const linkMap = new Map<string, Record<string, string>>();
  for (const r of links.rows) {
    if (!linkMap.has(r.key)) linkMap.set(r.key, {});
    linkMap.get(r.key)![r.domain] = r.url;
  }
  const domains = Array.from(new Set(links.rows.map((r) => r.domain))).sort();

  const players = rows.map((r) => {
    const name = r.key
      .split("-")
      .filter(Boolean)
      .map((p) => p[0]?.toUpperCase() + p.slice(1))
      .join(" ");
    return {
      key: r.key,
      name,
      links: linkMap.get(r.key) ?? {},
      lastSeen: r.last_seen,
    };
  });

  return <PlayerMatrix players={players} domains={domains} />;
}
