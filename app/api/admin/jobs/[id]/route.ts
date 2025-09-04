// app/api/admin/jobs/[id]/route.ts
import { NextResponse } from "next/server";
import { getJob } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string | string[] };

export async function GET(
  _req: Request,
  context: { params: Promise<Params> } // 👈 Next 15: params is a Promise
) {
  const { id: idRaw } = await context.params;               // 👈 await it
  const id = Array.isArray(idRaw) ? idRaw[0] : idRaw;

  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  try {
    const job = await getJob(id);
    if (!job) {
      return NextResponse.json({ error: "Job not found", id }, { status: 404 });
    }
    // Shape your UI can read directly
    return NextResponse.json({ job }, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: "DB error", detail: String(err) },
      { status: 500 }
    );
  }
}
