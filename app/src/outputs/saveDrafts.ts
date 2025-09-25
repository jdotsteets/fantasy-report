import { dbQuery } from "@/lib/db";
import type { Draft } from "../types";

/** Inserts or upserts drafts into social_drafts. */
export async function saveDrafts(drafts: Draft[]): Promise<void> {
  if (drafts.length === 0) return;

  // Expect Draft.id like `${articleId}:${platform}:v${n}`
  const rows = drafts.map((d) => {
    const articleId = Number(d.topicRef);
    return {
      article_id: articleId,
      platform: d.platform,
      hook: d.hook,
      body: d.body,
      cta: d.cta ?? null,
      media_url: d.mediaPath ?? null,
      scheduled_for: d.scheduledFor ?? null,
      status: d.status
    };
  });

  const valuesSql = rows
    .map(
      (_r, i) =>
        `($${i * 8 + 1}, $${i * 8 + 2}, $${i * 8 + 3}, $${i * 8 + 4}, $${i * 8 + 5}, $${i * 8 + 6}, $${i * 8 + 7}, $${i * 8 + 8})`
    )
    .join(", ");

  const params = rows.flatMap((r) => [
    r.article_id,
    r.platform,
    r.status,
    r.hook,
    r.body,
    r.cta,
    r.media_url,
    r.scheduled_for
  ]);

  await dbQuery(
    `
    insert into social_drafts
      (article_id, platform, status, hook, body, cta, media_url, scheduled_for)
    values ${valuesSql}
    `,
    params
  );
}
