import { NextRequest, NextResponse } from "next/server";
import { dbQuery, dbQueryRows } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ───────────────────────── Types ───────────────────────── */

type ArticleRow = {
  id: number;
  title: string | null;
  url: string | null;
  canonical_url: string | null;
  image_url: string | null;
  domain: string | null;
  source_name?: string | null; // if you have it
  published_at: string | null;
};

type Scraped = {
  url: string;
  canonicalUrl?: string;
  title: string;
  imageUrl?: string;
  publishedAt?: string;
  domain: string;
};

/* ─────────────────────── Helpers (no any) ─────────────────────── */

function normUrl(u: string): string {
  try {
    const x = new URL(u.trim());
    // strip hash, keep search
    x.hash = "";
    return x.toString();
  } catch {
    return u.trim();
  }
}

function domainOf(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function textBetween(s: string, start: string, end: string): string | null {
  const i = s.indexOf(start);
  if (i === -1) return null;
  const j = s.indexOf(end, i + start.length);
  if (j === -1) return null;
  return s.slice(i + start.length, j);
}

function pickFirst<T>(...vals: (T | null | undefined)[]): T | undefined {
  for (const v of vals) if (v != null) return v;
  return undefined;
}

function isoOrUndefined(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

/** Very small, dependency-free scraper for OG/Twitter/JSON-LD */
async function scrapeBasic(url: string): Promise<Scraped> {
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
  const html = await res.text();

  const og = (prop: string) =>
    html.match(new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)["']`, "i"))?.[1];

  const tw = (name: string) =>
    html.match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, "i"))?.[1];

  const ldJson = (() => {
    const m = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!m) return undefined;
    try {
      const obj = JSON.parse(m[1]);
      // article or newsarticle, or array of them
      const pick = Array.isArray(obj) ? obj.find((x) => x?.["@type"]?.toString().toLowerCase().includes("article")) : obj;
      const headline = (pick?.headline ?? pick?.name) as string | undefined;
      const img =
        (typeof pick?.image === "string" ? pick.image : Array.isArray(pick?.image) ? pick.image[0] : pick?.image?.url) as
          | string
          | undefined;
      const date =
        (pick?.datePublished ?? pick?.dateCreated ?? pick?.uploadDate) as string | undefined;
      return { headline, img, date };
    } catch {
      return undefined;
    }
  })();

  const canonical = textBetween(html, '<link rel="canonical" href="', '"');

  const title = pickFirst(
    og("og:title"),
    tw("twitter:title"),
    ldJson?.headline,
    // <title>…</title>
    html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim()
  )?.trim();

  const image = pickFirst(og("og:image"), tw("twitter:image"), ldJson?.img);
  const published = isoOrUndefined(pickFirst(og("article:published_time"), ldJson?.date));

  return {
    url,
    canonicalUrl: canonical ? normUrl(canonical) : undefined,
    title: (title && title.replace(/\s+/g, " ").trim()) || new URL(url).hostname,
    imageUrl: image,
    publishedAt: published,
    domain: domainOf(url),
  };
}

/** UPSERT into articles, returning the row */
async function upsertArticle(s: Scraped): Promise<ArticleRow> {
  // Prefer canonical if trustworthy and same domain; otherwise keep original URL
  const primaryUrl = s.canonicalUrl && domainOf(s.canonicalUrl) ? s.canonicalUrl : s.url;

  const rows = await dbQueryRows<ArticleRow>(
    `
    insert into articles (
      url, canonical_url, title, image_url, domain, published_at, discovered_at, sport
    ) values (
      $1, $2, $3, $4, $5, $6, now(), $7
    )
    on conflict (lower(url)) do update
      set title        = coalesce(excluded.title, articles.title),
          image_url    = coalesce(excluded.image_url, articles.image_url),
          canonical_url= coalesce(excluded.canonical_url, articles.canonical_url),
          domain       = coalesce(excluded.domain, articles.domain),
          published_at = coalesce(excluded.published_at, articles.published_at)
    returning id, title, url, canonical_url, image_url, domain, published_at
    `,
    [
      primaryUrl,
      s.canonicalUrl ?? null,
      s.title,
      s.imageUrl ?? null,
      s.domain,
      s.publishedAt ?? null,
      // naive NFL check; your classifier can later refine this
      /\bnfl\b|fantasy[- ]football/i.test(`${s.title} ${primaryUrl}`) ? "nfl" : null,
    ]
  );

  return rows[0];
}

/* ───────────────────────── Route ───────────────────────── */

export async function POST(req: NextRequest) {
  const payload = (await req.json().catch(() => null)) as { url?: string } | null;
  const raw = (payload?.url ?? "").trim();
  if (!raw) return NextResponse.json({ ok: false, error: "Missing url" }, { status: 400 });

  const url = normUrl(raw);

  // 1) find by url or canonical_url
  let a = (
    await dbQueryRows<ArticleRow>(
      `
      select id, title, url, canonical_url, image_url, domain, published_at
        from articles
       where lower(url) = lower($1) or lower(coalesce(canonical_url,'')) = lower($1)
       order by id desc
       limit 1
      `,
      [url]
    )
  )[0];

  // 2) if not found, scrape + upsert
  if (!a) {
    const scraped = await scrapeBasic(url);
    const upserted = await upsertArticle(scraped);
    a = upserted;
  }

  // 3) write hero row
  await dbQuery(
    `insert into site_hero (article_id, url, title, image_url, source)
     values ($1, $2, $3, $4, $5)`,
    [
      a.id,
      a.canonical_url ?? a.url ?? url,
      a.title ?? "(untitled)",
      a.image_url,
      a.domain ?? "The Fantasy Report",
    ]
  );

  return NextResponse.json({ ok: true, articleId: a.id });
}
