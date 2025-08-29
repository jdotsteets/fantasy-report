// app/api/admin/route.ts
import { NextRequest, NextResponse } from "next/server";
import { ingestAllSources } from "@/lib/ingest";
import {
  getSourcesHealth,
  getSourceErrorDigests,
  type HealthSummary,
} from "@/lib/adminHealth";
import * as cheerio from "cheerio";
import { dbQuery } from "@/lib/db";
import { logIngestError } from "@/lib/ingestLogs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireKey(req: NextRequest) {
  const want = process.env.ADMIN_KEY ?? "";
  const got = req.headers.get("x-admin-key") ?? "";
  return want && got && got === want;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const task = (searchParams.get("task") || "health").toLowerCase();

  if (task === "health") {
    const windowHours = Math.max(1, Number(searchParams.get("windowHours") || 72));
    const includeErrors = (searchParams.get("includeErrors") || "0") === "1";

    const summary: HealthSummary = await getSourcesHealth(windowHours);
    if (includeErrors) {
      summary.errors = await getSourceErrorDigests(windowHours);
    }
    return NextResponse.json({ ok: true, task: "health", summary });
  }

  // ─── testScrape (read-only, optional logging) ───────────────────────────────
  if (task === "testscrape") {
    const id = Number(searchParams.get("sourceId") || searchParams.get("id") || "");
    if (!Number.isFinite(id)) {
      return NextResponse.json({ ok: false, error: "bad_source_id" }, { status: 400 });
    }

    // Pull defaults from DB
    const src = (
      await dbQuery<{
        homepage_url: string | null;
        scrape_selector: string | null;
        name: string | null;
      }>("SELECT homepage_url, scrape_selector, name FROM sources WHERE id = $1", [id])
    ).rows[0];

    if (!src) {
      return NextResponse.json({ ok: false, error: "source_not_found" }, { status: 404 });
    }

    const url = (searchParams.get("url") || src.homepage_url || "").trim();
    const selector = (searchParams.get("selector") || src.scrape_selector || "").trim();
    const limit = Math.max(1, Math.min(Number(searchParams.get("limit") || 20), 100));
    const shouldLog = (searchParams.get("log") || "0") === "1";

    if (!url) return NextResponse.json({ ok: false, error: "missing_url" }, { status: 400 });
    if (!selector)
      return NextResponse.json({ ok: false, error: "missing_selector" }, { status: 400 });

    try {
      const res = await fetch(url, {
        headers: { "user-agent": "FantasyReportBot/1.0" },
        cache: "no-store",
      });

      if (!res.ok) {
        if (shouldLog) {
          await logIngestError({
            source_id: id,
            reason: "fetch_error",
            url,
            detail: `Status code ${res.status}`,
          });
        }
        return NextResponse.json({ ok: false, error: `fetch_failed_${res.status}` }, { status: 502 });
      }

      const html = await res.text();
      const $ = cheerio.load(html);
      const toAbs = (href: string): string | null => {
        try {
          return new URL(href, url).toString();
        } catch {
          return null;
        }
      };

      const out: Array<{ href: string; text: string }> = [];
      const seen = new Set<string>();
      $(selector).each((_, el) => {
        if (out.length >= limit) return;
        const href = $(el).attr("href") || "";
        const abs = toAbs(href);
        if (!abs) return;
        if (seen.has(abs)) return;
        seen.add(abs);
        const text = $(el).text().trim().replace(/\s+/g, " ").slice(0, 160);
        out.push({ href: abs, text });
      });

      if (out.length === 0 && shouldLog) {
        await logIngestError({
          source_id: id,
          reason: "invalid_item",
          url,
          detail: `selector returned 0 elements: ${selector}`,
        });
      }

      return NextResponse.json({
        ok: true,
        task: "testScrape",
        source: { id, name: src.name, defaultUrl: src.homepage_url, defaultSelector: src.scrape_selector },
        url,
        selector,
        limit,
        hits: out,
      });
    } catch (e: any) {
      if (shouldLog) {
        await logIngestError({
          source_id: id,
          reason: "fetch_error",
          url,
          detail: e?.message ?? "network error",
        });
      }
      return NextResponse.json({ ok: false, error: "testscrape_failed" }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: false, error: "unknown_task" }, { status: 400 });
}

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const task = (searchParams.get("task") || "").toLowerCase();

  if (!requireKey(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  if (task === "ingest") {
    const limit = Number(searchParams.get("limit") || 50);
    const res = await ingestAllSources(limit);

    const includeHealth = (searchParams.get("includeHealth") || "0") === "1";
    const includeErrors = (searchParams.get("includeErrors") || "0") === "1";
    const windowHours = Math.max(1, Number(searchParams.get("windowHours") || 72));

    if (includeHealth) {
      const tallies: Record<number, { inserted: number; updated: number; skipped: number }> = {};
      for (const [k, v] of Object.entries(res)) {
        const id = Number(k);
        tallies[id] = { inserted: v.inserted, updated: v.updated, skipped: v.skipped };
      }
      const summary: HealthSummary = await getSourcesHealth(windowHours, tallies);
      if (includeErrors) {
        summary.errors = await getSourceErrorDigests(windowHours);
      }
      return NextResponse.json({ ok: true, task: "ingest", res, summary });
    }

    return NextResponse.json({ ok: true, task: "ingest", res });
  }

  return NextResponse.json({ ok: false, error: "unknown_task" }, { status: 400 });
}
