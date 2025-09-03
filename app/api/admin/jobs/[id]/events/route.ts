import { NextResponse } from "next/server";
import { getEventsSince } from "@/lib/jobs";

export async function GET(req: Request, context: any) {
  const url = new URL(req.url);
  const afterRaw = url.searchParams.get("after");
  const after = afterRaw == null ? undefined : Number(afterRaw);

  if (afterRaw != null && Number.isNaN(after)) {
    return NextResponse.json(
      { error: "invalid 'after' query param" },
      { status: 400 }
    );
  }

  // context.params.id can be string | string[]
  const idRaw = context?.params?.id;
  const id = Array.isArray(idRaw) ? idRaw[0] : idRaw;

  if (typeof id !== "string" || !id) {
    return NextResponse.json({ error: "missing id param" }, { status: 400 });
  }

  const events = await getEventsSince(id, after);
  return NextResponse.json({ events });
}
