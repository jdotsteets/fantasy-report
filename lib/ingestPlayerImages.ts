// lib/ingestPlayerImages.ts
import { dbQuery } from "@/lib/db";

/** Matches your real table columns: key + url (with sensible defaults) */
export type PlayerImageUpsert = {
  key: string;                 // e.g., "nfl:gsis:00-0031234" or "nfl:name:puka-nacua"
  url: string;
  displayName?: string | null;
  team?: string | null;
  position?: string | null;
  source?: string | null;      // e.g., "team-site", "api", "article"
  license?: string | null;
  width?: number | null;
  height?: number | null;
  altUrls?: string[] | null;
  sourceRank?: number | null;  // lower = preferred; default 100
};

export async function upsertPlayerImage(p: PlayerImageUpsert): Promise<void> {
  await dbQuery(
    `
    INSERT INTO player_images
      (key, url, display_name, team, position, source, license,
       width, height, alt_urls, last_checked_at, updated_at, created_at, source_rank)
    VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now(), now(), now(), coalesce($11, 100))
    ON CONFLICT (key) DO UPDATE SET
      url = EXCLUDED.url,
      display_name = coalesce(EXCLUDED.display_name, player_images.display_name),
      team = coalesce(EXCLUDED.team, player_images.team),
      position = coalesce(EXCLUDED.position, player_images.position),
      source = coalesce(EXCLUDED.source, player_images.source),
      license = coalesce(EXCLUDED.license, player_images.license),
      width = coalesce(EXCLUDED.width, player_images.width),
      height = coalesce(EXCLUDED.height, player_images.height),
      alt_urls = case when EXCLUDED.alt_urls is not null then EXCLUDED.alt_urls else player_images.alt_urls end,
      last_checked_at = now(),
      updated_at = now(),
      source_rank = least(player_images.source_rank, coalesce(EXCLUDED.source_rank, player_images.source_rank))
    `,
    [
      p.key,
      p.url,
      p.displayName ?? null,
      p.team ?? null,
      p.position ?? null,
      p.source ?? null,
      p.license ?? null,
      p.width ?? null,
      p.height ?? null,
      p.altUrls ?? null,
      p.sourceRank ?? null,
    ]
  );
}

/** Convenience shim so existing scraper calls can stay simple if they used different names. */
export async function upsertPlayerImageSimple(row: { key: string; url: string }): Promise<void> {
  await upsertPlayerImage({
    key: row.key,
    url: row.url,
    source: "scraper",
    sourceRank: 80, // prefer scraper over generic "article" if you want
  });
}
