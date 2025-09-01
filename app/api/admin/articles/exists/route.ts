// app/api/admin/articles/exists/route.ts
import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { urls: string[] };

export async function POST(req: NextRequest) {
  try {
    const { urls } = (await req.json()) as Body;
    if (!Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json({ error: "urls required" }, { status: 400 });
    }
    // normalize + dedupe
    const list = Array.from(new Set(urls.map((u) => u.trim()).filter(Boolean)));
    if (list.length === 0) {
      return NextResponse.json({ exists: {} }, { status: 200 });
    }

    const rows = (
      await dbQuery<{ url: string }>(
        `select url from articles where url = any($1::text[])`,
        [list]
      )
    ).rows;

    const set = new Set(rows.map((r) => r.url));
    const exists: Record<string, boolean> = {};
    for (const u of list) exists[u] = set.has(u);

    return NextResponse.json({ exists }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
