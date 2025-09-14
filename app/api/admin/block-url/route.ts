import { NextResponse } from "next/server";
import { blockUrl, deleteArticleByCanonical, listBlocked } from "@/lib/blocklist";

// If you already export these from your ingest module, import from there instead.
// Otherwise keep these small helpers here.
async function resolveFinalUrl(input: string): Promise<string> {
  try {
    const r = await fetch(input, { method: "HEAD", redirect: "follow" });
    if (r.ok) return r.url || input;
  } catch {}
  const g = await fetch(input, { method: "GET", redirect: "follow" });
  return g.url || input;
}
function chooseCanonical(rawCanonical: string | null | undefined, pageUrl: string): string {
  const canon = (rawCanonical ?? "").trim();
  if (!canon) return pageUrl;
  try {
    const cu = new URL(canon);
    const pu = new URL(pageUrl);
    const path = cu.pathname.replace(/\/+$/, "");
    const generic = new Set([
      "", "/", "/research", "/news", "/blog", "/articles",
      "/sports", "/nfl", "/fantasy", "/fantasy-football",
    ]);
    if (generic.has(path)) return pageUrl;
    const cSeg = cu.pathname.split("/").filter(Boolean).length;
    const pSeg = pu.pathname.split("/").filter(Boolean).length;
    if (cu.host === pu.host && cSeg < 2 && pSeg >= 2) return pageUrl;
    return cu.toString();
  } catch {
    return pageUrl;
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Allow preflight (helps if the browser sends OPTIONS)
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Methods": "POST,GET,OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
    },
  });
}

export async function GET() {
  const entries = await listBlocked(200);
  return NextResponse.json({ ok: true, entries });
}

type PostBody = { url?: string; deleteExisting?: boolean; reason?: string; createdBy?: string };

export async function POST(req: Request) {
  // Accept JSON or form posts
  let url = "", reason = "", deleteExisting = true, createdBy = "admin";
  const ct = (req.headers.get("content-type") || "").toLowerCase();

  try {
    if (ct.includes("application/json")) {
      const b = (await req.json()) as PostBody;
      url = String(b.url ?? "");
      reason = String(b.reason ?? "");
      deleteExisting = b.deleteExisting !== false;
      if (b.createdBy) createdBy = String(b.createdBy);
    } else if (ct.includes("application/x-www-form-urlencoded")) {
      const fd = await req.formData();
      url = String(fd.get("url") ?? "");
      reason = String(fd.get("reason") ?? "");
      deleteExisting = String(fd.get("deleteExisting") ?? "true") !== "false";
      createdBy = String(fd.get("createdBy") ?? createdBy);
    } else {
      const t = await req.text();
      if (t) {
        const b = JSON.parse(t) as PostBody;
        url = String(b.url ?? "");
        reason = String(b.reason ?? "");
        deleteExisting = b.deleteExisting !== false;
        if (b.createdBy) createdBy = String(b.createdBy);
      }
    }
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body" }, { status: 400 });
  }

  if (!/^https?:\/\//i.test(url)) {
    return NextResponse.json({ ok: false, error: "Provide a valid http(s) URL" }, { status: 400 });
  }

  // Normalize: resolve final + pick canonical
  const resolved = await resolveFinalUrl(url);
  const canonical = chooseCanonical(null, resolved);

  await blockUrl(canonical, reason, createdBy);

  let deleted = 0;
  if (deleteExisting) {
    deleted = await deleteArticleByCanonical(canonical);
  }

  return NextResponse.json({ ok: true, canonical, deleted });
}
