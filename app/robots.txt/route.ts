// app/robots.txt/route.ts (if you’re using this)
import type { NextRequest } from "next/server";

export const runtime = "edge";

const SITE = "https://thefantasyreport.com";

function robotsTxt(): string {
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /admin/",
    "Disallow: /api/",
    `Sitemap: ${SITE}/sitemap.xml`,
    ""
  ].join("\n");
}

export async function GET(_req: NextRequest) {
  return new Response(robotsTxt(), {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, must-revalidate"
    }
  });
}
