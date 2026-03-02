// app/api/backfill-published/route.ts
import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { resolvePublished } from "@/lib/dates/resolvePublished";


type Row = { id: number; url: string | null; canonical_url: string | null };
type Result = { updated: number; skipped: number; failed: number; sample: number[] };

function preferUrl(canonical: string | null, url: string | null): string | null {
  if (canonical && canonical.trim() !== "") return canonical;
  if (url && url.trim() !== "") return url;
  return null;
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;

  // ───────────────────────── params ─────────────────────────
  const limit = Math.min(Math.max(Number(q.get("limit") ?? "200"), 1), 2000);
  const dryRun = (q.get("dryRun") ?? "false").toLowerCase() === "true";
  const domain = (q.get("domain") ?? "").trim() || null;
  const sourceId = q.get("sourceId") ? Number(q.get("sourceId")) : null;

  // ───────────────────────── selection ─────────────────────────
  const params: Array<string | number> = [];
  let p = 0;
  const push = (v: string | number) => {
    params.push(v);
    return ++p;
  };

  push(limit); // $1

  let whereSql = `WHERE published_at IS NULL`;

  if (Number.isFinite(sourceId)) {
    whereSql += ` AND source_id = $${push(sourceId!)} `;
  }

  if (domain) {
    // normalize “www.” on both sides – use two placeholders intentionally
    const d1 = push(domain);
    const d2 = push(domain);
    whereSql += `
      AND (
        LOWER(domain) = LOWER($${d1})
        OR LOWER(REPLACE(domain,'www.','')) = LOWER(REPLACE($${d2},'www.',''))
      )
    `;
  }

  const selectSql = `
    SELECT id, url, canonical_url
    FROM articles
    ${whereSql}
    ORDER BY id DESC
    LIMIT $1
  `;
  const res = await dbQuery<Row>(selectSql, params);
  const rows = res.rows;

  // ───────────────────────── backfill loop ─────────────────────────
  let updated = 0,
    skipped = 0,
    failed = 0;
  const touchedIds: number[] = [];

  const UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 TFRBot/1.0";

  const tryFetch = async (url: string) => {
    try {
      const resp = await fetch(url, {
        redirect: "follow",
        headers: { "user-agent": UA },
      });
      const lastModified = resp.headers.get("last-modified") || resp.headers.get("date");
      const headerIso =
        lastModified && !Number.isNaN(new Date(lastModified).getTime())
          ? new Date(lastModified).toISOString()
          : null;
      const text = await resp.text();
      return { text, headerIso };
    } catch {
      return { text: null as string | null, headerIso: null as string | null };
    }
  };

  const batchSize = 10;
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);

    await Promise.all(
      chunk.map(async (r) => {
        const pageUrl = preferUrl(r.canonical_url, r.url);
        if (!pageUrl) {
          skipped++;
          return;
        }

        // 1) primary fetch
        const { text: html, headerIso } = await tryFetch(pageUrl);
        if (!html && !headerIso) {
          failed++;
          return;
        }

        let result = resolvePublished({
          url: pageUrl,
          html: html ?? "",
          nowIso: new Date().toISOString(),
        });

        // 2) header fallback when HTML had nothing
        let iso = result.published_at ?? null;
        let src = result.published_source ?? null;

        if (!iso && headerIso) {
          iso = headerIso;
          src = "modified"; // fits your CHECK constraint
        }

        // 3) AMP/alt variants if still nothing (helps SPA sites)
        if (!iso) {
          const bases: string[] = [];
          try {
            const u = new URL(pageUrl);
            u.pathname = u.pathname.replace(/\/$/, "");
            bases.push(u.toString());
          } catch {
            bases.push(pageUrl.replace(/\/$/, ""));
          }

          const candidates = [
            bases[0] + "/amp",
            pageUrl + (pageUrl.includes("?") ? "&amp=1" : "?amp=1"),
            pageUrl + (pageUrl.includes("?") ? "&outputType=amp" : "?outputType=amp"),
          ];

          for (const alt of candidates) {
            const { text: ampHtml, headerIso: ampHeaderIso } = await tryFetch(alt);
            if (!ampHtml && !ampHeaderIso) continue;

            const r2 = resolvePublished({
              url: alt,
              html: ampHtml ?? "",
              nowIso: new Date().toISOString(),
            });

            if (r2.published_at) {
              iso = r2.published_at;
              src = r2.published_source ?? "meta";
              break;
            }
            if (!iso && ampHeaderIso) {
              iso = ampHeaderIso;
              src = "modified";
              break;
            }
          }
        }

        if (!iso) {
          // still nothing
          skipped++;
          return;
        }

        // Normalize source to your CHECK list (map unknowns → "meta")
        const allowed = new Set([
          "rss",
          "atom",
          "dc",
          "jsonld",
          "og",
          "meta",
          "time-tag",
          "url",
          "sitemap",
          "modified",
        ]);
        const rawSrc = src ?? null;
        const finalSrc = rawSrc && allowed.has(rawSrc) ? rawSrc : rawSrc ? "meta" : null;

        if (dryRun) {
          updated++;
          touchedIds.push(r.id);
          return;
        }

        const updSql = `
          UPDATE articles
          SET published_at = $2::timestamptz,
              published_raw = NULLIF($3::text,''),
              published_source = NULLIF($4::text,''),
              published_confidence = $5::int,
              published_tz = NULLIF($6::text,'')
          WHERE id = $1
        `;
        const updParams: [
          number,
          string,
          string | null,
          string | null,
          number | null,
          string | null
        ] = [
          r.id,
          iso,
          result.published_raw ?? null,
          finalSrc,
          result.published_confidence ?? null,
          result.published_tz ?? null,
        ];

        try {
          await dbQuery(updSql, updParams);
          updated++;
          touchedIds.push(r.id);
        } catch {
          failed++;
        }
      })
    );
  }

  const body: Result = { updated, skipped, failed, sample: touchedIds.slice(0, 20) };
  return NextResponse.json(body);
}
