import { NextRequest, NextResponse } from "next/server";
import { dbQueryRows, dbQueryRow } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const rows = await dbQueryRows<{ id: number; name: string; area: string; status: string }>(
    `select id, name, area, status from exec.projects order by created_at desc limit 200`
  );
  return NextResponse.json({ ok: true, items: rows });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { name?: string; area?: string };
  const name = (body.name ?? "").trim();
  const area = (body.area ?? "general").trim() || "general";
  if (!name) return NextResponse.json({ ok: false, error: "name is required" }, { status: 400 });

  const row = await dbQueryRow<{ id: number }>(
    `insert into exec.projects (name, area) values ($1, $2) returning id`,
    [name, area]
  );

  return NextResponse.json({ ok: true, id: row?.id ?? null });
}
