// app/api/img/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isSafeUrl(u: string): boolean {
  try {
    const url = new URL(u);
    return (url.protocol === "https:" || url.protocol === "http:") && !!url.hostname;
  } catch {
    return false;
  }
}

export async function GET(req: Request) {
  const u = new URL(req.url).searchParams.get("u") || "";
  if (!u || u.length > 2000 || !isSafeUrl(u)) {
    return NextResponse.json({ ok: false, error: "invalid_url" }, { status: 400 });
  }

  // Some CDNs require a browser-y UA or matching referer/origin.
  const upstreamHeaders: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
    Accept: "image/avif,image/webp,image/*;q=0.8,*/*;q=0.5",
    Referer: new URL(u).origin,
  };

  const res = await fetch(u, { redirect: "follow", headers: upstreamHeaders });
  if (!res.ok || !res.body) {
    return NextResponse.json({ ok: false, status: res.status }, { status: 502 });
  }

  const ct = res.headers.get("content-type") || "image/jpeg";
  const out = new NextResponse(res.body, {
    status: 200,
    headers: {
      "Content-Type": ct,
      // Cache aggressively at the edge + browser
      "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
  return out;
}
