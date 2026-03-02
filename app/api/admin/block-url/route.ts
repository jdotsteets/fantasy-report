// app/api/admin/block-url/route.ts
import { NextResponse } from "next/server";
import { blockUrl, deleteArticleByCanonical, listBlocked } from "@/lib/blocklist";

// ───────────────────────── helpers ─────────────────────────

// Resolve exactly one redirect hop (no follow)
async function oneHopRedirect(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { method: "HEAD", redirect: "manual" });
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get("location");
      if (loc) return new URL(loc, url).toString();
    }
  } catch {}
  return null;
}

// Resolve to the final URL (follow redirects; fall back to GET if HEAD blocked)
async function resolveFinalUrl(input: string): Promise<string> {
  try {
    const r = await fetch(input, { method: "HEAD", redirect: "follow" });
    if (r.ok) return r.url || input;
  } catch {}
  try {
    const g = await fetch(input, { method: "GET", redirect: "follow" });
    return g.url || input;
  } catch {
    return input;
  }
}

// Very light canonical chooser: if caller has a “real” canonical, prefer it.
// With null canonical, just return pageUrl (but normalize host casing / strip trailing slash noise)
function chooseCanonical(rawCanonical: string | null | undefined, pageUrl: string): string {
  const normalize = (u: string) => {
    const url = new URL(u);
    url.hostname = url.hostname.replace(/^www\./, "").toLowerCase();
    // drop trailing slash unless root
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
    url.hash = "";
    return url.toString();
  };

  const canon = (rawCanonical ?? "").trim();
  if (!canon) return normalize(pageUrl);

  try {
    const cu = new URL(canon);
    const pu = new URL(pageUrl);
    const path = cu.pathname.replace(/\/+$/, "");
    const generic = new Set([
      "", "/", "/research", "/news", "/blog", "/articles",
      "/sports", "/nfl", "/fantasy", "/fantasy-football",
    ]);
    if (generic.has(path)) return normalize(pageUrl);

    const cSeg = cu.pathname.split("/").filter(Boolean).length;
    const pSeg = pu.pathname.split("/").filter(Boolean).length;
    if (cu.host === pu.host && cSeg < 2 && pSeg >= 2) return normalize(pageUrl);

    return normalize(cu.toString());
  } catch {
    return normalize(pageUrl);
  }
}

// ───────────────────────── route config ─────────────────────────

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// CORS preflight
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Methods": "POST,GET,OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
    },
  });
}

// List recently-blocked URLs
export async function GET() {
  const entries = await listBlocked(200);
  return NextResponse.json({ ok: true, entries });
}

// ───────────────────────── POST: block URL(s) ─────────────────────────

type PostBody = {
  url?: string;
  deleteExisting?: boolean;
  reason?: string;
  createdBy?: string;
};

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

  // Build the candidate set: original, one-hop, and final.
  const original = new URL(url).toString();
  const hop = await oneHopRedirect(original);
  const finalResolved = await resolveFinalUrl(original);

  // Canonicalize each variant the same way we canonicalize article rows
  const cOriginal = chooseCanonical(null, original);
  const cHop = hop ? chooseCanonical(null, hop) : null;
  const cFinal = chooseCanonical(null, finalResolved);

  // De-duplicate while preserving order (original → hop → final)
  const canonicals: string[] = [];
  const seen = new Set<string>();
  for (const c of [cOriginal, cHop, cFinal]) {
    if (c && !seen.has(c)) {
      seen.add(c);
      canonicals.push(c);
    }
  }

  // Insert all blocklist rows and (optionally) delete existing articles for each
  const saved: string[] = [];
  const already: string[] = [];
  const deleteCounts: Record<string, number> = {};

for (const c of canonicals) {
  try {
    // idempotent insert (unique index on url)
    await blockUrl(c, reason, createdBy);
    // no need to check {ok}; the function returns void/idempotent
    saved.push(c);
    if (deleteExisting) {
      deleteCounts[c] = await deleteArticleByCanonical(c);
    }
  } catch (e) {
    // ignore duplicates, collect any that already existed
    already.push(c);
  }
}

return NextResponse.json({
  ok: true,
  saved,       // the variants we inserted
  already,     // the variants that already existed
  deleted: Object.values(deleteCounts).reduce((a, b) => a + (b ?? 0), 0),
});
}
