// lib/blocklist.ts
import { dbQuery } from "@/lib/db";

export async function blockUrl(url: string, reason?: string, createdBy?: string): Promise<void> {
  await dbQuery(
    `INSERT INTO blocked_urls (url, reason, created_by)
     VALUES ($1, NULLIF($2,''), NULLIF($3,''))
     ON CONFLICT (url) DO NOTHING`,
    [url, reason ?? "", createdBy ?? ""]
  );
}

export async function unblockUrl(url: string): Promise<number> {
  const { rowCount } = await dbQuery(`DELETE FROM blocked_urls WHERE url = $1`, [url]);
  return rowCount ?? 0;
}

export async function isUrlBlocked(url: string): Promise<boolean> {
  const { rows } = await dbQuery<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM blocked_urls WHERE url = $1) AS exists`,
    [url]
  );
  return Boolean(rows?.[0]?.exists);
}

export async function deleteArticleByCanonical(canonicalUrl: string): Promise<number> {
  const { rowCount } = await dbQuery(
    `DELETE FROM articles WHERE canonical_url = $1`,
    [canonicalUrl]
  );
  return rowCount ?? 0;
}

export type BlockedEntry = { url: string; reason: string | null; created_at: string; host: string | null };

export async function listBlocked(limit = 200): Promise<BlockedEntry[]> {
  const { rows } = await dbQuery<BlockedEntry>(
    `SELECT url, reason, created_at::text, host FROM blocked_urls
     ORDER BY created_at DESC
     LIMIT $1`,
    [Math.max(1, Math.min(limit, 1000))]
  );
  return rows;
}
