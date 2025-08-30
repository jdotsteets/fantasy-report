// app/api/admin/route.ts
import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { dbQuery } from "@/lib/db";
import { logIngestError, type IngestReason } from "@/lib/ingestLogs";

export const runtime = "nodejs";         // ensure Node runtime (not edge)
export const dynamic = "force-dynamic";  // NEVER prerender this route
export const revalidate = 0;             // disable caching for the route



type SourceRow = {
  id: number;
  name: string | null;
  homepage_url: string | null;
  scrape_selector: string | null;
};

type Hit = { href: string; text: string };

function getErrorMessage(err: unknown): string {
  if (err instanceof Error && typeof err.message === "string") return err.message;
  if (typeof err === "string") return err;
  try { return JSON.stringify(err); } catch { return "unknown_error"; }
}

function domainOf(u?: string | null): string | null {
  if (!u) return null;
  try { return new URL(u).hostname.replace(/^www\./i, ""); } catch { return null; }
}

function absolutize(baseUrl: string, href?: string | null): string | null {
  if (!href) return null;
  try { return new URL(href, baseUrl).toString(); } catch { return null; }
}

export async function GET(req: NextRequest) {
  const u = new URL(req.url);
  const q = u.searchParams;
  const task = (q.get("task") ?? "").toLowerCase();

  if (task !== "testscrape") {
    return NextResponse.json({ ok: false, error: "unknown_task" }, { status: 400 });
  }

  // accept ?sourceId= OR ?id=
  const idStr = q.get("sourceId") ?? q.get("id") ?? "";
  const id = Number(idStr);
  const limit = Math.max(1, Math.min(Number(q.get("limit") ?? "20") || 20, 100));
  const urlOverride = (q.get("url") || "").trim() || null;
  const selectorOverride = (q.get("selector") || "").trim() || null;
  const shouldLog = (q.get("log") ?? "0") === "1";

  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: "missing_or_invalid_id" }, { status: 400 });
  }

  // load source
  const srcRes = await dbQuery<SourceRow>(
    "select id, name, homepage_url, scrape_selector from sources where id=$1",
    [id]
  );
  if (srcRes.rows.length === 0) {
    return NextResponse.json({ ok: false, error: "source_not_found" }, { status: 404 });
  }
  const src = srcRes.rows[0];

  // Decide URL + selector
  const DEFAULT_SELECTOR = 'a[href*="/nfl/"]';

  // Prefer override URL, else source homepage_url
  let url = (urlOverride || src.homepage_url || "").trim();

  // If override is a relative path, resolve against homepage
  if (urlOverride && urlOverride.startsWith("/") && src.homepage_url) {
    try {
      url = new URL(urlOverride, src.homepage_url).toString();
    } catch {
      // keep as-is; fetch will error and be logged
    }
  }

  const selector = (selectorOverride || src.scrape_selector || DEFAULT_SELECTOR).trim();

  if (!url) {
    return NextResponse.json(
      { ok: false, error: "no_url_available", source: { id: src.id, name: src.name } },
      { status: 400 }
    );
  }
  if (!selector) {
    return NextResponse.json(
      { ok: false, error: "no_selector_available", source: { id: src.id, name: src.name } },
      { status: 400 }
    );
  }

  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": "FantasyReportBot/1.0 (+https://fantasy-report.vercel.app)",
        accept: "text/html,application/xhtml+xml",
      },
      cache: "no-store",
    });

    if (!res.ok) {
      if (shouldLog) {
        await logIngestError({
          sourceId: id,
          url,
          domain: domainOf(url),
          reason: "fetch_error",
          detail: `HTTP ${res.status}`,
        });
      }
      return NextResponse.json(
        { ok: false, error: "http_error", status: res.status },
        { status: 502 }
      );
    }

    const html = await res.text();
    const $ = cheerio.load(html);
    const hits: Hit[] = [];
    const seen = new Set<string>();

    $(selector).each((_, el) => {
      if (hits.length >= limit) return;
      const hrefRaw = $(el).attr("href") ?? "";
      const text = ($(el).text() ?? "").trim();
      const abs = absolutize(url, hrefRaw);
      if (!hrefRaw || !text || !abs) return;
      if (seen.has(abs)) return;
      seen.add(abs);
      hits.push({ href: abs, text });
    });

    if (hits.length === 0 && shouldLog) {
      await logIngestError({
        sourceId: id,
        url,
        domain: domainOf(url),
        reason: "scrape_no_matches",
        detail: `selector "${selector}" matched 0 links`,
      });
    }

    return NextResponse.json({
      ok: true,
      task: "testScrape",
      source: { id: src.id, name: src.name },
      url,
      selector,
      limit,
      hits,
    });
  } catch (err: unknown) {
    if (shouldLog) {
      await logIngestError({
        sourceId: id,
        url,
        domain: domainOf(url),
        reason: "fetch_error",
        detail: getErrorMessage(err),
      });
    }
    return NextResponse.json({ ok: false, error: "testscrape_failed" }, { status: 500 });
  }
}
