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

function withUtm(url: string, p: { source?: string | null; medium?: string | null; campaign?: string | null }): string {
  const u = new URL(url);
  if (p.source) u.searchParams.set("utm_source", p.source);
  if (p.medium) u.searchParams.set("utm_medium", p.medium);
  if (p.campaign) u.searchParams.set("utm_campaign", p.campaign);
  return u.toString();
}

export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  const slug = params.slug;
  const rows = await dbQueryRows<Short>(
    `select id, dest_url, utm_source, utm_medium, utm_campaign
       from link_short
      where slug = $1
      limit 1`,
    [slug]
  );
  if (rows.length === 0) {
    return NextResponse.redirect(new URL("/", req.url));
  }
  const s = rows[0];
  const dest = withUtm(s.dest_url, { source: s.utm_source, medium: s.utm_medium, campaign: s.utm_campaign });

// log click (fire-and-forget)
// In Node runtime NextRequest has no `.ip`; use headers on Vercel
const xfwd = req.headers.get("x-forwarded-for") ?? "";
const ipFromHeader = (xfwd.split(",")[0]?.trim() || req.headers.get("x-real-ip")) ?? null;
const ua = req.headers.get("user-agent") ?? null;

    // don't await; fire-and-forget
    dbQuery(
    `insert into link_click (short_id, ip, ua) values ($1, $2, $3)`,
    [s.id, ipFromHeader, ua]
    ).catch(() => {});

  return NextResponse.redirect(dest, { status: 302 });
}
