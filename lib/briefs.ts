// lib/briefs.ts
import { dbQueryRows } from "@/lib/db";
import { slugify } from "@/lib/slug";
import type { Brief, BriefWithArticle } from "@/types/briefs";


function rand5(): string {
  return Math.random().toString(36).slice(2, 7);
}

export async function createBrief(payload: {
  article_id: number;
  summary: string;
  why_matters: string[];
  seo_title?: string | null;
  seo_description?: string | null;
  status?: "draft" | "published" | "archived";
  slug?: string;
}): Promise<Brief> {
  // 0) If brief already exists, return it (idempotency)
  const existing = await dbQueryRows<Brief>(
    `SELECT * FROM briefs WHERE article_id = $1 LIMIT 1`,
    [payload.article_id]
  );
  if (existing[0]) return existing[0];

  // 1) Build a base slug from the article title
  const art = await dbQueryRows<{ title: string }>(
    `SELECT title FROM articles WHERE id = $1`,
    [payload.article_id]
  );
  if (!art[0]) throw new Error("Article not found");

  const base = payload.slug ?? slugify(art[0].title);
  const baseWithId = `${base}-${payload.article_id.toString(36)}`;

  // 2) Try insert; if slug collides, retry with random suffix.
  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const slug = attempt === 0 ? baseWithId : `${baseWithId}-${rand5()}`;
    try {
      // ON CONFLICT ON article_id -> update fields (keeps original slug if conflict fires)
      const rows = await dbQueryRows<Brief>(
        `
        INSERT INTO briefs (article_id, slug, summary, why_matters, seo_title, seo_description, status)
        VALUES ($1, $2, $3, $4::jsonb, $5, $6, COALESCE($7::brief_status, 'published'::brief_status))
        ON CONFLICT (article_id) DO UPDATE SET
          summary = EXCLUDED.summary,
          why_matters = EXCLUDED.why_matters,
          seo_title = EXCLUDED.seo_title,
          seo_description = EXCLUDED.seo_description,
          status = EXCLUDED.status,              -- EXCLUDED.status is already brief_status
          updated_at = now()
        RETURNING *;
        `,
        [
          payload.article_id,
          slug,
          payload.summary,
          JSON.stringify(payload.why_matters),
          payload.seo_title ?? null,
          payload.seo_description ?? null,
          payload.status ?? null,                // string | null is fine; cast happens in SQL
        ]
      );
      return rows[0];
    } catch (e) {
      const msg = String(e);
      // If slug unique collides, retry with a new suffix; otherwise bubble up
      if (/duplicate key value.*slug/.test(msg)) continue;
      throw e;
    }
  }
  throw new Error("Failed to create brief with a unique slug after retries");
}

export async function getBriefBySlug(slug: string): Promise<BriefWithArticle | null> {
  const rows = await dbQueryRows<BriefWithArticle>(
    `SELECT * FROM briefs_with_article WHERE slug = $1 LIMIT 1`,
    [slug]
  );
  return rows[0] ?? null;
}

// lib/briefs.ts (append below existing code)
export async function updateBrief(
  id: number,
  patch: Partial<{
    summary: string;
    why_matters: string[];
    seo_title: string | null;
    seo_description: string | null;
    status: "draft" | "published" | "archived";
    slug: string;
  }>
): Promise<Brief> {
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error("Invalid brief id");
  }

  const fields: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (patch.summary !== undefined) {
    fields.push(`summary = $${i++}`);
    values.push(patch.summary);
  }
  if (patch.why_matters !== undefined) {
    fields.push(`why_matters = $${i++}::jsonb`);
    values.push(JSON.stringify(patch.why_matters));
  }
  if (patch.seo_title !== undefined) {
    fields.push(`seo_title = $${i++}`);
    values.push(patch.seo_title);
  }
  if (patch.seo_description !== undefined) {
    fields.push(`seo_description = $${i++}`);
    values.push(patch.seo_description);
  }
  if (patch.status !== undefined) {
    // Cast to enum type
    fields.push(`status = $${i++}::brief_status`);
    values.push(patch.status);
  }
  if (patch.slug !== undefined) {
    fields.push(`slug = $${i++}`);
    values.push(patch.slug);
  }

  if (fields.length === 0) {
    throw new Error("No valid fields to update");
  }

  // touch updated_at
  fields.push(`updated_at = now()`);

  values.push(id);
  const sql = `UPDATE briefs SET ${fields.join(", ")} WHERE id = $${i} RETURNING *;`;
  const rows = await dbQueryRows<Brief>(sql, values);
  if (!rows[0]) throw new Error("Brief not found");
  return rows[0];
}

export async function listBriefs(limit = 50): Promise<BriefWithArticle[]> {
  return dbQueryRows<BriefWithArticle>(
    `
    SELECT * FROM briefs_with_article
    ORDER BY coalesce(published_at, created_at) DESC
    LIMIT $1
    `,
    [limit]
  );
}

export async function getBriefById(id: number): Promise<BriefWithArticle | null> {
  const rows = await dbQueryRows<BriefWithArticle>(
    `SELECT * FROM briefs_with_article WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}
