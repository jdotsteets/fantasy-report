// lib/baseUrl.ts
/**
 * Get base URL for server-side internal API calls.
 * Never uses VERCEL_URL (preview-deployment logic breaks production).
 */
export function getServerBaseUrl(): string {
  // 1. Explicit production URL (SITE_URL should be set in Vercel env vars)
  if (process.env.SITE_URL) {
    return process.env.SITE_URL.replace(/\/+$/, "");
  }

  // 2. Fallback to public URL
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, "");
  }

  // 3. Local development
  return "http://localhost:3000";
}
