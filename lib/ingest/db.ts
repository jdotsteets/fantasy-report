import { dbQuery } from "@/lib/db";
import type { ArticleInput, SourceRow, UpsertResult } from "./types";
import { normalizeImageForStorage } from "./normalize";
import { isWeakArticleImage } from "@/lib/images"; // keep your existing import location
import { findArticleImage } from "../scrape-image";

export function rowsOf<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  const obj = res as { rows?: T[] };
  return Array.isArray(obj?.rows) ? (obj.rows as T[]) : [];
}

export function hostnameOf(url: string | null | undefined) {
  try { return url ? new URL(url).hostname : null; } catch { return null; }
}

export async function getSource(sourceId: number): Promise<SourceRow | null> {
  const res = await dbQuery<SourceRow>(`SELECT id, name, allowed, rss_url, homepage_url, scrape_selector FROM sources WHERE id=$1`, [sourceId]);
  return rowsOf<SourceRow>(res)[0] ?? null;
}

export async function getAllowedSources(): Promise<SourceRow[]> {
  const res = await dbQuery<SourceRow>(`SELECT id, name, allowed, rss_url, homepage_url, scrape_selector FROM sources WHERE COALESCE(allowed, true) = true ORDER BY id ASC`, []);
  return rowsOf<SourceRow>(res);
}

export async function upsertArticle(row: ArticleInput): Promise<UpsertResult> {
  const pageUrl = (row.url ?? row.link ?? row.canonical_url ?? "").trim();
  if (!pageUrl) return { updated: true };

  const canonical = (row.canonical_url ?? "").trim() || pageUrl;
  const url = pageUrl;

  const params = [
    canonical, url, row.source_id ?? row.sourceId ?? null,
    row.title ?? null, row.author ?? null, row.published_at ?? row.publishedAt ?? null,
    normalizeImageForStorage(row.image_url ?? null), // cleaned here
    row.domain ?? null, row.sport ?? null,
    Array.isArray(row.topics) ? row.topics : null,
    row.primary_topic ?? null, row.secondary_topic ?? null,
    row.week ?? null,
    Array.isArray(row.players) ? row.players : null,
    row.is_player_page ?? null
  ];

  const sql = `
    INSERT INTO articles (
      canonical_url, url, source_id, title, author, published_at,
      image_url, domain, sport, discovered_at,
      topics, primary_topic, secondary_topic, week, players, is_player_page
    ) VALUES (
      $1::text, $2::text, $3::int, NULLIF($4::text,''), NULLIF($5::text,''), $6::timestamptz,
      NULLIF($7::text,''), NULLIF($8::text,''), NULLIF($9::text,''), NOW(),
      $10::text[], NULLIF($11::text,''), NULLIF($12::text,''), $13::int, $14::text[],
      COALESCE($15::bool, false)
    )
    ON CONFLICT (canonical_url)
    DO UPDATE SET
      url             = COALESCE(EXCLUDED.url, articles.url),
      title           = COALESCE(EXCLUDED.title, articles.title),
      author          = COALESCE(EXCLUDED.author, articles.author),
      published_at    = COALESCE(EXCLUDED.published_at, articles.published_at),
      image_url       = COALESCE(EXCLUDED.image_url, articles.image_url),
      domain          = COALESCE(EXCLUDED.domain, articles.domain),
      sport           = COALESCE(EXCLUDED.sport, articles.sport),
      topics          = COALESCE(EXCLUDED.topics, articles.topics),
      primary_topic   = COALESCE(EXCLUDED.primary_topic, articles.primary_topic),
      secondary_topic = COALESCE(EXCLUDED.secondary_topic, articles.secondary_topic),
      week            = COALESCE(EXCLUDED.week, articles.week),
      players         = COALESCE(EXCLUDED.players, articles.players),
      is_player_page  = articles.is_player_page OR COALESCE(EXCLUDED.is_player_page, false)
    RETURNING (xmax = 0) AS inserted;
  `;
  const res = await dbQuery<{ inserted: boolean }>(sql, params);
  const inserted = !!rowsOf<{ inserted: boolean }>(res)[0]?.inserted;
  return inserted ? { inserted: true } : { updated: true };
}

export async function backfillArticleImage(
  articleId: number,
  canonicalUrl: string,
  currentImageUrl: string | null,
): Promise<string | null> {
  const hasUsable = !!currentImageUrl && !isWeakArticleImage(currentImageUrl);
  if (hasUsable) return currentImageUrl;

  const raw = await findArticleImage(canonicalUrl);
  const best = normalizeImageForStorage(raw);
  if (!best) {
    await dbQuery(`UPDATE articles SET image_checked_at = NOW() WHERE id = $1`, [articleId]);
    return null;
  }
  await dbQuery(
    `UPDATE articles SET image_url = $2, image_source = 'scraped', image_checked_at = NOW() WHERE id = $1`,
    [articleId, best]
  );
  return best;
}
