// app/src/links/short.ts
import { dbQuery, dbQueryRows } from "@/lib/db";

type ShortRow = { slug: string };

export async function ensureShortlinkForArticle(
  articleId: number,
  destUrl: string,
  campaign: string
): Promise<string> {
  const slug = `a${articleId}`;
  const existing = await dbQueryRows<ShortRow>(
    `select slug from link_short where slug=$1 limit 1`,
    [slug]
  );
  if (existing.length === 0) {
    await dbQuery(
      `insert into link_short (slug, dest_url, utm_campaign)
       values ($1, $2, $3)`,
      [slug, destUrl, campaign]
    );
  }
  return `https://www.thefantasyreport.com/go/${slug}`;
}

export async function ensureShortlinkForBrief(
  briefId: number,
  destUrl: string,
  campaign: string
): Promise<string> {
  const slug = `b${briefId}`;
  const existing = await dbQueryRows<ShortRow>(
    `select slug from link_short where slug=$1 limit 1`,
    [slug]
  );
  if (existing.length === 0) {
    await dbQuery(
      `insert into link_short (slug, dest_url, utm_campaign)
       values ($1, $2, $3)`,
      [slug, destUrl, campaign]
    );
  }
  return `https://www.thefantasyreport.com/go/${slug}`;
}
