// lib/social/ensureBriefLink.ts
import { dbQueryRows } from "@/lib/db";

type BriefRow = { id: number; slug: string; status: "draft" | "published" | "archived" };

export async function ensureBriefPublished(article_id: number): Promise<BriefRow> {
  const existing = await dbQueryRows<BriefRow>(
    `SELECT id, slug, status FROM briefs WHERE article_id = $1 LIMIT 1`,
    [article_id]
  );

  if (existing[0]?.status === "published") return existing[0];
  // If exists but not published, keep it; we’ll overwrite only if you want that policy.
  if (existing[0]) return existing[0];

  // Create new published brief via your generator API
  const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/briefs/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ article_id, autopublish: true, overwrite: false }),
  });

  if (!res.ok) throw new Error(`Failed to generate brief: ${await res.text()}`);
  const data = (await res.json()) as { created_brief_id: number; slug: string };
  return { id: Number(data.created_brief_id), slug: data.slug, status: "published" };
}

export function appendShortLink(body: string, briefId: number, maxLen = 280): string {
  const link = ` https://www.thefantasyreport.com/b/${briefId}`;
  if (body.length + link.length <= maxLen) return body + link;
  // Trim with ellipsis to fit
  const room = Math.max(0, maxLen - link.length - 1);
  const trimmed = body.slice(0, room).replace(/\s+[^\s]*$/, ""); // avoid chopping in the middle of a word
  return `${trimmed}…${link}`;
}
