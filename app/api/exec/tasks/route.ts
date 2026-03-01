import { NextRequest, NextResponse } from "next/server";
import { dbQueryRows, dbQueryRow } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status");
  const sql = status
    ? `select * from exec.task_rollup where status = $1 order by created_at desc limit 300`
    : `select * from exec.task_rollup order by created_at desc limit 300`;
  const rows = status
    ? await dbQueryRows(sql, [status])
    : await dbQueryRows(sql);
  return NextResponse.json({ ok: true, items: rows });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    title?: string;
    notes?: string;
    category?: string;
    priority?: number;
    status?: string;
    due_date?: string | null;
    project_id?: number | null;
  };

  const title = (body.title ?? "").trim();
  if (!title) return NextResponse.json({ ok: false, error: "title is required" }, { status: 400 });

  const row = await dbQueryRow<{ id: number }>(
    `insert into exec.tasks (title, notes, category, priority, status, due_date, project_id)
     values ($1,$2,$3,$4,$5,$6,$7)
     returning id`,
    [
      title,
      body.notes ?? null,
      (body.category ?? "general").trim() || "general",
      Number.isFinite(body.priority) ? Math.max(1, Math.min(5, Number(body.priority))) : 3,
      (body.status ?? "inbox").trim() || "inbox",
      body.due_date ?? null,
      body.project_id ?? null,
    ]
  );

  return NextResponse.json({ ok: true, id: row?.id ?? null });
}
