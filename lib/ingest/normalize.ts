import { isWeakArticleImage, isLikelyAuthorHeadshot, unproxyNextImage } from "@/lib/images";

export function toPlayerKey(name: string): string {
  return `nfl:name:${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
}

export function looksUsableImage(u: string | null | undefined): u is string {
  if (!u) return false;
  const s = u.trim();
  if (!/^https?:\/\//i.test(s)) return false;
  if (/\.svg(\?|#|$)/i.test(s)) return false;
  if (isLikelyAuthorHeadshot(s)) return false;
  return !isWeakArticleImage(s);
}

export function normalizeImageForStorage(src?: string | null): string | null {
  const un = unproxyNextImage(src ?? null);
  if (!un) return null;
  if (isLikelyAuthorHeadshot(un)) return null;
  if (isWeakArticleImage(un)) return null;
  return un;
}

export async function resolveFinalUrl(input: string): Promise<string> {
  try {
    const r = await fetch(input, { method: "HEAD", redirect: "follow" });
    if (r.ok) return r.url || input;
  } catch {}
  const g = await fetch(input, { method: "GET", redirect: "follow" });
  return g.url || input;
}

export function isLikelyDeadRedirect(u: URL): boolean {
  const host = u.hostname.toLowerCase();
  const path = u.pathname.replace(/\/+$/, "").toLowerCase();
  if (host === "www.fanduel.com" && (path === "" || path === "/research")) return true;
  if (path === "" || path === "/") return true;
  return false;
}

export function toDateOrNull(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === "string" && v.trim() !== "") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function inferWeekFromText(title: string | null, url: string): number | null {
  const hay = `${title ?? ""} ${url}`.toLowerCase();
  const m = hay.match(/\bweek\s*:?\s*(\d{1,2})\b/);
  return m ? Number(m[1]) : null;
}

export function isGenericCanonical(canon: string, original?: string | null): boolean {
  try {
    const cu = new URL(canon);
    const path = cu.pathname.replace(/\/+$/, "");
    const generic = new Set(["", "/", "/research", "/news", "/blog", "/articles", "/sports", "/nfl", "/fantasy", "/fantasy-football"]);
    if (generic.has(path)) return true;
    if (original) {
      const ou = new URL(original);
      const cSeg = cu.pathname.split("/").filter(Boolean).length;
      const oSeg = ou.pathname.split("/").filter(Boolean).length;
      if (cu.host === ou.host && cSeg < 2 && oSeg >= 2) return true;
    }
  } catch {}
  return false;
}

export function chooseCanonical(rawCanonical: string | null | undefined, pageUrl: string | null | undefined): string | null {
  const canon = (rawCanonical ?? "").trim() || null;
  const page  = (pageUrl ?? "").trim() || null;
  if (canon && !isGenericCanonical(canon, page)) return canon;
  return page;
}
