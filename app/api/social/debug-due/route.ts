// app/api/social/debug-due/route.ts
import { NextResponse } from "next/server";
import { dbQueryRows } from "@/lib/db";
export async function GET() {
  const rows = await dbQueryRows(
    `select d.id, d.platform, d.status, d.scheduled_for
     from social_drafts d
     where d.platform='x' and d.status='scheduled' and d.scheduled_for <= now()
     order by d.scheduled_for asc limit 20`
  );
  return NextResponse.json({ due: rows });
}


