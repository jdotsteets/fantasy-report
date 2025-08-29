// app/api/admin/route.ts
import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { dbQuery } from "@/lib/db";
import { logIngestError, type IngestReason } from "@/lib/ingestLogs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ───────────────────────── Types ───────────────────────── */

type SourceRow = {
  id: number;
  name: string | null;
  homepage_url: string | null;
  scrape_selector: string | null;
  scrape_path?: string | null; // optional in your schema
};

type Hit = { href: string; text: string };

/* ──────────────────────── Utilities ─────────────────────── */

function getErrorMessage(err: unknown): string {
  if (err instanceof Error && typeof err.message === "string") return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return "unknown_error";
  }
}

function domainOf(u?: string | null): string | null {
  if (!u) return null;
  try {
    return new URL(u).hostname.replace(/^www\./i, "");
  } catch {
    return null;
  }
}

function absolutize(baseUrl: string, href?: string | null): string | null {
  if (!href) return null;
  try {
    const u = new URL(href, baseUrl);
    return u.toString();
  } catch {
    return null;
  }
}

function buildEffectiveHomepageUrl(
  homepage: string | null,
  path: string | null | undefined
): string | null {
  if (!homepage) return null;
  try {
    const base = new URL(homepage);
    if (path && path.trim()) {
      return new URL(path, base).toString();
    }
    return base.toString();
  } catch {
    // fall back to the string as-is if URL parsing fails
    return homepage;
  }
}

/* ───────────────────────── Route ───────────────────────── */

export async function GET(req: NextRequest) {
  const u = new URL(req.url);
  const q = u.searchParams;
  const task = (q.get("task") ?? "").toLowerCase();

  if (task === "testscrape") {
    const id = Number(q.get("id"));
    const limit = Math.max(1, Math.min(Number(q.get("limit") ?? "20") || 20, 100));
    const urlOverride = q.get("url") || null;
    const selectorOverride = q.get("selector") || null;
    const shouldLog = (q.get("log") ?? "0") === "1";

    if (!Number.isFinite(id)) {
      return NextResponse.json(
        { ok: false, error: "missing_or_invalid_id" },
        { status: 400 }
      );
    }

    // fetch source row
    const srcRes = await dbQuery<SourceRow>("select id, name, homepage_url, scrape_selector, scrape_path from sources where id=$1", [id]);
    if (srcRes.rows.length === 0) {
      return NextResponse.json({ ok: false, error: "source_not_found" }, { status: 404 });
    }
    const src = srcRes.rows[0];

    // pick effective URL and selector
    const defaultUrl = buildEffectiveHomepageUrl(src.homepage_url, src.scrape_path);
    const defaultSelector = src.scrape_selector ?? undefined;

    const url = (urlOverride || defaultUrl || "").trim();
    const selector = (selectorOverride || defaultSelector || "").trim();

    if (!url) {
      return NextResponse.json(
        { ok: false, error: "no_url_available", source: { id: src.id, name: src.name, defaultUrl, defaultSelector } },
        { status: 400 }
      );
    }
    if (!selector) {
      return NextResponse.json(
        { ok: false, error: "no_selector_available", source: { id: src.id, name: src.name, defaultUrl, defaultSelector } },
        { status: 400 }
      );
    }

    try {
      const hits: Hit[] = [];

      const res = await fetch(url, {
        headers: { "user-agent": "FantasyReportBot/1.0 (+https://fantasy-report.vercel.app)" },
        cache: "no-store",
      });

      if (!res.ok) {
        if (shouldLog) {
          const reason: IngestReason = "fetch_error";
          await logIngestError({
            sourceId: id,
            url,
            domain: domainOf(url),
            reason,
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
        const reason: IngestReason = "scrape_no_matches";
        await logIngestError({
          sourceId: id,
          url,
          domain: domainOf(url),
          reason,
          detail: `selector "${selector}" matched 0 links`,
        });
      }

      return NextResponse.json({
        ok: true,
        task: "testScrape",
        source: {
          id: src.id,
          name: src.name,
          defaultUrl,
          defaultSelector: src.scrape_selector ?? null,
        },
        url,
        selector,
        limit,
        hits,
      });
    } catch (err: unknown) {
      if (shouldLog) {
        const reason: IngestReason = "fetch_error";
        await logIngestError({
          sourceId: id,
          url,
          domain: domainOf(url),
          reason,
          detail: getErrorMessage(err),
        });
      }
      return NextResponse.json(
        { ok: false, error: "testscrape_failed" },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ ok: false, error: "unknown_task" }, { status: 400 });
}
