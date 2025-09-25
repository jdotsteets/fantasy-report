// scripts/load-sleeper-players.ts
import { dbQuery } from "@/lib/db";

type SleeperPlayer = {
  player_id: string;          // Sleeper's canonical id (string)
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  position?: string | null;   // e.g., QB, RB, WR, TE, DEF
  team?: string | null;       // e.g., KC, BUF, HOU
  team_abbr?: string | null;  // sometimes present
  active?: boolean | null;
  aliases?: string[] | null;  // sometimes present
};

type PlayerRow = {
  player_id: string;
  full_name: string;          // normalized non-empty (required)
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  team: string | null;
  active: boolean | null;
  search_names: string[] | null;
};

/* ---------------------------------------
   Helpers to normalize Sleeper records
---------------------------------------- */

function coalesceName(p: Partial<SleeperPlayer>): string | null {
  const fromParts = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
  if (p.full_name && p.full_name.trim()) return p.full_name.trim();
  if (fromParts) return fromParts;

  // Team defenses often have null full_name.
  if ((p.position || "").toUpperCase() === "DEF") {
    const team =
      (p.team || (p as any).team_abbr || p.player_id || "")
        .toString()
        .trim()
        .toUpperCase();
    if (team) return `${team} D/ST`;
  }
  return null;
}

function buildSearchNames(fullName: string, p: Partial<SleeperPlayer>): string[] {
  const names = new Set<string>();
  const add = (v?: string | null) => {
    if (v && String(v).trim()) names.add(String(v).trim());
  };

  add(fullName);
  add(p.last_name);
  if (p.first_name && p.last_name) add(`${p.first_name} ${p.last_name}`);

  if ((p.position || "").toUpperCase() === "DEF") {
    const team =
      (p.team || (p as any).team_abbr || p.player_id || "")
        .toString()
        .trim()
        .toUpperCase();
    if (team) {
      add(`${team} D/ST`);
      add(`${team} Defense`);
      add(team);
    }
  }

  if (Array.isArray((p as any).aliases)) {
    for (const a of (p as any).aliases as string[]) add(a);
  }

  return Array.from(names);
}

function toRow(p: SleeperPlayer): PlayerRow | null {
  if (!p?.player_id) return null;
  const fullName = coalesceName(p);
  if (!fullName) return null; // skip nameless/garbage entries

  const first = p.first_name?.trim() || null;
  const last = p.last_name?.trim() || null;
  const pos = p.position?.trim() || null;
  const team =
    (p.team || p.team_abbr)?.toString().trim().toUpperCase() || null;

  const search_names = buildSearchNames(fullName, p);
  return {
    player_id: String(p.player_id).trim(),
    full_name: fullName,                 // guaranteed non-empty here
    first_name: first,
    last_name: last,
    position: pos,
    team,
    active: p.active !== false,          // default true
    search_names: search_names.length ? search_names : null,
  };
}

/* ---------------------------------------
   Batched upsert via jsonb_to_recordset
---------------------------------------- */

async function upsertBatch(rows: PlayerRow[]) {
  if (!rows.length) return;

  const sql = `
    INSERT INTO players (
      player_id, full_name, first_name, last_name,
      position, team, active, search_names, updated_at
    )
    SELECT
      p.player_id,
      -- keep NOT NULL constraint happy (we enforce in code, but double-guard here)
      COALESCE(NULLIF(p.full_name, ''), 'Unknown') AS full_name,
      NULLIF(p.first_name, ''),
      NULLIF(p.last_name, ''),
      NULLIF(p.position, ''),
      NULLIF(p.team, ''),
      COALESCE(p.active, true),
      p.search_names,
      NOW()
    FROM jsonb_to_recordset($1::jsonb) AS p(
      player_id    text,
      full_name    text,
      first_name   text,
      last_name    text,
      position     text,
      team         text,
      active       boolean,
      search_names text[]
    )
    ON CONFLICT (player_id) DO UPDATE SET
      full_name    = COALESCE(EXCLUDED.full_name, players.full_name),
      first_name   = COALESCE(EXCLUDED.first_name, players.first_name),
      last_name    = COALESCE(EXCLUDED.last_name, players.last_name),
      position     = COALESCE(EXCLUDED.position, players.position),
      team         = COALESCE(EXCLUDED.team, players.team),
      active       = COALESCE(EXCLUDED.active, players.active),
      search_names = COALESCE(EXCLUDED.search_names, players.search_names),
      updated_at   = NOW();
  `;

  await dbQuery(sql, [JSON.stringify(rows)]);
}

/* ---------------------------------------
   Main
---------------------------------------- */

async function run() {
  console.log("Fetching Sleeper players…");
  const res = await fetch("https://api.sleeper.app/v1/players/nfl");
  if (!res.ok) throw new Error(`Sleeper HTTP ${res.status}`);
  const data = (await res.json()) as Record<string, SleeperPlayer>;

  const allRaw = Object.values(data);
  const all = allRaw.map(toRow).filter(Boolean) as PlayerRow[];

  console.log(`Upserting ${all.length} players…`);

  const BATCH = 2000;
  for (let i = 0; i < all.length; i += BATCH) {
    const chunk = all.slice(i, i + BATCH);
    await upsertBatch(chunk);
    console.log(`  • ${Math.min(i + BATCH, all.length)} / ${all.length}`);
  }
  console.log("Done.");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
