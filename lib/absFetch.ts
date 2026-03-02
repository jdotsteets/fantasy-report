// lib/absFetch.ts
import { headers } from "next/headers";

/** Build an absolute URL for server-side fetches (sync) */
export function absUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;

  // tolerate Next type changes: treat headers() as Headers
  const hdrs = headers() as unknown as Headers;

  const host =
    hdrs.get("x-forwarded-host") ??
    hdrs.get("host") ??
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/^https?:\/\//, "") ??
    `localhost:${process.env.PORT ?? 3000}`;

  const proto =
    hdrs.get("x-forwarded-proto") ??
    (process.env.NEXT_PUBLIC_SITE_URL?.startsWith("https://") ? "https" : "http");

  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${proto}://${host}${clean}`;
}

/** Server-safe fetch that accepts relative paths (async) */
export async function absFetch(input: string, init?: RequestInit) {
  return fetch(absUrl(input), init);
}
