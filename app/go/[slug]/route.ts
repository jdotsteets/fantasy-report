// app/go/[slug]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { dbQueryRows, dbQuery } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Short = {
  id: number;
  dest_url: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
};

function withUtm(
  url: string,
  p: { source?: string | null; medium?: string | null; campaign?: string | null }
): string {
  const u = new URL(url);
  if (p.source) u.searchParams.set("utm_source", p.source);
  if (p.medium) u.searchParams.set("utm_medium", p.medium);
  if (p.campaign) u.searchParams.set("utm_campaign", p.campaign);
  return u.toString();
}

function getClientIp(req: NextRequest): string | null {
  const xfwd = req.headers.get("x-forwarded-for") ?? "";
  const first = xfwd.split(",")[0]?.trim();
  return first || req.headers.get("x-real-ip") || null;
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> } // <- params is a Promise in Next 15
) {
  const { slug } = await ctx.params; // <- await it

  // 1) Try shortlink table
  const short = await dbQueryRows<Short>(
    `select id, dest_url, utm_source, utm_medium, utm_campaign
       from link_short
      where slug = $1
      limit 1`,
    [slug]
  );

  if (short.length > 0) {
    const s = short[0];
    const dest = withUtm(s.dest_url, {
      source: s.utm_source,
      medium: s.utm_medium,
      campaign: s.utm_campaign,
    });

    const ip = getClientIp(req);
    const ua = req.headers.get("user-agent") ?? null;
    // fire-and-forget
    dbQuery(
      `insert into link_click (short_id, ip, ua) values ($1, $2, $3)`,
      [s.id, ip, ua]
    ).catch(() => {});

    return NextResponse.redirect(dest, { status: 302 });
  }

  // 2) Legacy numeric fallback: /go/123 -> articles.url
  if (/^\d+$/.test(slug)) {
    const articleId = Number(slug);
    const rows = await dbQueryRows<{ url: string }>(
      `select url from articles where id = $1 limit 1`,
      [articleId]
    );
    if (rows.length > 0) {
      const dest = rows[0].url;
      const ip = getClientIp(req);
      const ua = req.headers.get("user-agent") ?? null;
      const ref = req.headers.get("referer") ?? req.headers.get("referrer") ?? null;
      dbQuery(
        `insert into clicks (article_id, ref, ua, ip) values ($1, $2, $3, $4)`,
        [articleId, ref, ua, ip]
      ).catch(() => {});
      return NextResponse.redirect(dest, { status: 302 });
    }
  }

  // 3) Not found -> home
  return NextResponse.redirect(new URL("/", req.url));
}
