// quick dev-only route: app/api/admin/waivers-extract-one/route.ts
import { NextResponse } from "next/server";
import { extractWaiverMentions } from "@/lib/waivers/extract";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const id = parseInt(u.searchParams.get("id") || "0", 10);
  const url = u.searchParams.get("url") || "";
  if (!id || !url) return NextResponse.json({ ok: false, error: "id & url required" }, { status: 400 });
  const n = await extractWaiverMentions(id, url);
  return NextResponse.json({ ok: true, inserted: n });
}
