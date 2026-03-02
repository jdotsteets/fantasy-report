import { NextRequest } from "next/server";
import { POST as seed } from "@/app/api/social/sections/seed/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const next = new URL(url.origin + "/api/social/sections/seed");
  next.searchParams.set("type", "waivers");
  const delay = url.searchParams.get("delay");
  if (delay) next.searchParams.set("delay", delay);

  const forward = new NextRequest(next.toString(), { method: "POST", headers: req.headers });
  return seed(forward);
}
