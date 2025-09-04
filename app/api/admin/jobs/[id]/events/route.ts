// app/api/admin/jobs/[id]/events/route.ts
import { NextResponse } from "next/server";
import { getEventsSince } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string | string[] };

export async function GET(
  req: Request,
  context: { params: Promise<Params> } // 👈 Next 15: params is a Promise
) {
  const { id: idRaw } = await context.params;               // 👈 await it
  const id = Array.isArray(idRaw) ? idRaw[0] : idRaw;

  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const afterParam = new URL(req.url).searchParams.get("after");
  const after = afterParam != null ? Number(afterParam) : undefined;
  const afterSafe = Number.isFinite(after as number) ? (after as number) : undefined;

  try {
    const events = await getEventsSince(id, afterSafe);
    // Shape your UI can read directly
    return NextResponse.json({ events }, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: "DB error", detail: String(err) },
      { status: 500 }
    );
  }
}
