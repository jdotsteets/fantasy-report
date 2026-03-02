// app/api/waivers/test-yahoo/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { extractYahoo } from "@/lib/site-extractors/yahoo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const u = new URL(req.url);
    const urlParam = u.searchParams.get("url");
    if (!urlParam) {
      return NextResponse.json(
        { ok: false, error: "Missing ?url=<yahoo-article-url>" },
        { status: 400 }
      );
    }

    let articleUrl: URL;
    try {
      articleUrl = new URL(urlParam);
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid URL" }, { status: 400 });
    }

    if (!/^(?:www\.)?sports\.yahoo\.com$/i.test(articleUrl.hostname)) {
      return NextResponse.json(
        { ok: false, error: "URL must be on sports.yahoo.com" },
        { status: 400 }
      );
    }

    // allow both /fantasy/* and /article/*
    if (!/^\/(?:fantasy|article)\b/i.test(articleUrl.pathname)) {
      return NextResponse.json(
        { ok: false, error: "Path must be /fantasy or /article on sports.yahoo.com" },
        { status: 400 }
      );
    }

    const res = await fetch(articleUrl.href, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
      },
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `Fetch failed`, status: res.status },
        { status: 502 }
      );
    }

    const html = await res.text();
    const hits = extractYahoo(html, articleUrl);

    // Always return JSON so jq has something to print
    return NextResponse.json({
      ok: true,
      url: articleUrl.href,
      count: hits.length,
      hits,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
