// lib/site-extractors/mapPlayers.ts
import { dbQuery } from "@/lib/db";

export type WaiverHit = { name: string; hint?: string; section?: string };
export type MappedPlayer = { player_id: string; full_name: string; from_hint?: string };

function posFrom(s?: string | null): string | null {
  if (!s) return null;
  const t = s.toUpperCase();
  if (/\bQB\b/.test(t)) return "QB";
  if (/\bRB\b/.test(t)) return "RB";
  if (/\bWR\b/.test(t)) return "WR";
  if (/\bTE\b/.test(t)) return "TE";
  if (/\bK\b/.test(t))  return "K";
  if (/\bDST\b|\bDEF\b/.test(t)) return "DEF";
  return null;
}

function pickFirstLast(raw: string): { first: string; last: string } | null {
  const cleaned = (raw || "")
    .replace(/\((?:[^)]*)\)\s*$/g, "")
    .replace(/[“”]/g, '"')
    .replace(/[’‘]/g, "'")
    .replace(/\s*[-–—]\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;

  const tokens = cleaned.match(/[A-Za-z][A-Za-z'-]*/g);
  if (!tokens || tokens.length < 2) return null;

  return { first: tokens[0]!.toLowerCase(), last: tokens[tokens.length - 1]!.toLowerCase() };
}

export async function mapPlayers(hits: WaiverHit[]): Promise<MappedPlayer[]> {
  const out: MappedPlayer[] = [];

  for (const h of hits) {
    const fl = pickFirstLast(h.name);
    if (!fl) continue;

    const hintedPos = posFrom(h.hint || h.section);

    const run = async (pos: string | null) => {
      // exact first/last tokens
      let r = await dbQuery<{ player_id: string; full_name: string }>(
        `
        SELECT player_id, full_name
        FROM players
        WHERE active = true
          AND team IS NOT NULL
          AND UPPER(COALESCE(position,'')) IN ('QB','RB','WR','TE','K','DEF','DST')
          AND lower(split_part(full_name,' ',1)) = $1
          AND lower(split_part(full_name,' ', array_length(regexp_split_to_array(full_name,'\\s+'),1))) = $2
          AND ($3::text IS NULL OR UPPER(position) = $3)
        LIMIT 1
        `,
        [fl.first, fl.last, pos]
      );
      if (r.rows?.[0]) return r.rows[0];

      // allow middle names
      r = await dbQuery<{ player_id: string; full_name: string }>(
        `
        SELECT player_id, full_name
        FROM players
        WHERE active = true
          AND team IS NOT NULL
          AND UPPER(COALESCE(position,'')) IN ('QB','RB','WR','TE','K','DEF','DST')
          AND lower(full_name) ~ $1
          AND ($2::text IS NULL OR UPPER(position) = $2)
        LIMIT 1
        `,
        [`^${fl.first}[[:space:]].*[[:space:]]${fl.last}$`, pos]
      );
      if (r.rows?.[0]) return r.rows[0];

      // alias match
      r = await dbQuery<{ player_id: string; full_name: string }>(
        `
        SELECT player_id, full_name
        FROM players
        WHERE active = true
          AND team IS NOT NULL
          AND UPPER(COALESCE(position,'')) IN ('QB','RB','WR','TE','K','DEF','DST')
          AND EXISTS (
            SELECT 1 FROM unnest(COALESCE(search_names, ARRAY[]::text[])) a
            WHERE lower(a) = lower($1)
          )
          AND ($2::text IS NULL OR UPPER(position) = $2)
        LIMIT 1
        `,
        [h.name, pos]
      );
      return r.rows?.[0] || null;
    };

    // try with hinted position first…
    let row = await run(hintedPos);
    // …then fall back to “any position” if nothing matched
    if (!row && hintedPos) row = await run(null);
    if (!row) continue;

    out.push({
      player_id: row.player_id,
      full_name: row.full_name,
      from_hint: h.hint ?? h.section,
    });
  }
  return out;
}
