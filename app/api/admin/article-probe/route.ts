// app/api/admin/article-probe/route.ts
import { NextRequest, NextResponse } from "next/server";
import * as pg from "pg";
import { STATIC_TYPES } from "@/lib/staticTypes";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export const runtime = "nodejs";

type Row = { id: number; name: string | null };




function matchContent(html: string, re: RegExp): string | null {
  const m = re.exec(html);
  return m?.[1]
    ? m[1]
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
    : null;
}

export async function POST(req: NextRequest) {
  const { url } = (await req.json().catch(() => ({}))) as { url?: string };
  if (!url) return NextResponse.json({ error: "Missing url" }, { status: 400 });

  let domain: string | null = null;
  try {
    const u = new URL(url);
    domain = u.host.replace(/^www\./, "");
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  let html = "";
  try {
    const r = await fetch(url, { redirect: "follow" });
    html = await r.text();
  } catch {
    // ignore network errors; we'll proceed with minimal data
  }

  let title: string | null = null;
  let canonical_url: string | null = null;
  let author: string | null = null;
  let published_at: string | null = null;

  if (html) {
    title =
      matchContent(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i) ??
      matchContent(html, /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)/i) ??
      matchContent(html, /<title>([^<]+)<\/title>/i) ??
      null;

    canonical_url =
      matchContent(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i) ?? null;

    author =
      matchContent(html, /<meta[^>]+name=["']author["'][^>]+content=["']([^"']+)/i) ??
      matchContent(html, /<meta[^>]+property=["']article:author["'][^>]+content=["']([^"']+)/i) ??
      null;

    const pub =
      matchContent(
        html,
        /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)/i
      ) ??
      matchContent(html, /<meta[^>]+name=["']date["'][^>]+content=["']([^"']+)/i) ??
      matchContent(html, /<time[^>]+datetime=["']([^"']+)/i) ??
      null;

    if (pub) {
      const d = new Date(pub);
      if (!Number.isNaN(d.getTime())) published_at = d.toISOString();
    }
  }

  // Find a matching source
  let source: Row | null = null;
  try {
    const like = `%://${domain}%`;
    const { rows } = await pool.query<Row>(
      `
      select id, name
      from sources
      where (homepage_url ilike $1) or (rss_url ilike $1) or (sitemap_url ilike $1)
      order by coalesce(priority, 0) desc, id asc
      limit 1
      `,
      [like]
    );
    source = rows[0] ?? null;
  } catch {
    source = null;
  }

  // Check for existing article by url or canonical (from request and probed)
  type Art = {
    id: number;
    source_id: number | null;
    url: string;
    canonical_url: string | null;
    title: string | null;
    author: string | null;
    published_at: string | null;
    domain: string | null;
    is_static: boolean | null;
    static_type: string | null;
  };

  let existing: Art | null = null;
  try {
    const { rows } = await pool.query<Art>(
      `
      select id, source_id, url, canonical_url, title, author, published_at,
             domain, is_static, static_type
      from articles
      where url = $1
         or canonical_url = $1
         or ($2 is not null and (url = $2 or canonical_url = $2))
      order by id asc
      limit 1
      `,
      [url, canonical_url]
    );
    existing = rows[0] ?? null;
  } catch {
    existing = null;
  }

  return NextResponse.json({
    url,
    canonical_url,
    title,
    author,
    published_at,
    source,
    domain,
    existing,
  });
}
