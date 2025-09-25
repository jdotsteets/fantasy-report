import { NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";


export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;


// Strictly validate payload
type Body = Partial<{
status: "draft" | "approved" | "scheduled" | "published" | "failed";
scheduled_for: string | null; // ISO
}>;


export async function PATCH(
_req: Request,
{ params }: { params: { id: string } }
) {
const id = Number(params.id);
if (!Number.isFinite(id)) {
return NextResponse.json({ error: "Invalid id" }, { status: 400 });
}


let body: Body;
try {
body = (await _req.json()) as Body;
} catch {
return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
}


const sets: string[] = [];
const args: Array<string | number | null> = [];

if ("status" in body && body.status) {
  sets.push(`status = $${sets.length + 1}`);
  args.push(body.status);
}

if ("scheduled_for" in body) {
  // scheduled_for may be string | null | undefined → normalize to string | null
  const when: string | null = body.scheduled_for ?? null;
  sets.push(`scheduled_for = $${sets.length + 1}`);
  args.push(when);
}

if (sets.length === 0) {
  return NextResponse.json({ error: "No updates supplied" }, { status: 400 });
}

args.push(id);

await dbQuery(
  `update social_drafts set ${sets.join(", ")}, updated_at = now() where id = $${sets.length + 1}`,
  args
);


return NextResponse.json({ ok: true });
}