// lib/briefs.ts
import { dbQuery, dbQueryRows } from "@/lib/db";
import { slugify } from "@/lib/slug";
import type { Brief, BriefWithArticle } from "@/types/briefs";

function shortHash(id: number): string {
  return id.toString(36).slice(-5);
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
  // Get article title to seed slug
  const [art] = await dbQueryRows<{ title: string }>(
    `SELECT title FROM articles WHERE id = $1`,
    [payload.article_id]
  );
  if (!art) throw new Error("Article not found");

  const baseSlug = payload.slug ?? slugify(art.title);
  const slug = `${baseSlug}-${shortHash(payload.article_id)}`;

  const rows = await dbQueryRows<Brief>(
    `
    INSERT INTO briefs (article_id, slug, summary, why_matters, seo_title, seo_description, status)
    VALUES ($1, $2, $3, $4::jsonb, $5, $6, COALESCE($7, 'published'))
    RETURNING *
    `,
    [
      payload.article_id,
      slug,
      payload.summary,
      JSON.stringify(payload.why_matters),
      payload.seo_title ?? null,
      payload.seo_description ?? null,
      payload.status ?? null,
    ]
  );
  return rows[0];
}

export async function updateBrief(id: number, patch: Partial<{
  summary: string;
  why_matters: string[];
  seo_title: string | null;
  seo_description: string | null;
  status: "draft" | "published" | "archived";
  slug: string;
}>): Promise<Brief> {
  // Build dynamic set safely
  const fields: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (patch.summary !== undefined) { fields.push(`summary = $${i++}`); values.push(patch.summary); }
  if (patch.why_matters !== undefined) { fields.push(`why_matters = $${i++}::jsonb`); values.push(JSON.stringify(patch.why_matters)); }
  if (patch.seo_title !== undefined) { fields.push(`seo_title = $${i++}`); values.push(patch.seo_title); }
  if (patch.seo_description !== undefined) { fields.push(`seo_description = $${i++}`); values.push(patch.seo_description); }
  if (patch.status !== undefined) { fields.push(`status = $${i++}`); values.push(patch.status); }
  if (patch.slug !== undefined) { fields.push(`slug = $${i++}`); values.push(patch.slug); }

  if (fields.length === 0) throw new Error("No updates provided");

  values.push(id);
  const sql = `UPDATE briefs SET ${fields.join(", ")} WHERE id = $${i} RETURNING *`;
  const rows = await dbQueryRows<Brief>(sql, values);
  return rows[0];
}

export async function getBriefBySlug(slug: string): Promise<BriefWithArticle | null> {
  const rows = await dbQueryRows<BriefWithArticle>(
    `SELECT * FROM briefs_with_article WHERE slug = $1`,
    [slug]
  );
  return rows[0] ?? null;
}
