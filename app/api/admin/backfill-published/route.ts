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
  const limit = Math.min(Math.max(Number(q.get("limit") ?? "200"), 1), 2000);
  const dryRun = (q.get("dryRun") ?? "false").toLowerCase() === "true";
  const domain = q.get("domain"); // optional: focus on one domain

  // 1) Load candidates
  const whereDomain = domain ? "AND domain = $2" : "";
  const params: Array<string | number> = [limit];
  if (domain) params.push(domain);

  const selectSql = `
    SELECT id, url, canonical_url
    FROM articles
    WHERE published_at IS NULL
    ${whereDomain}
    ORDER BY discovered_at DESC
    LIMIT $1
  `;
  const res = await dbQuery<Row>(selectSql, params);
  const rows = res.rows;

  let updated = 0, skipped = 0, failed = 0;
  const touchedIds: number[] = [];

  // 2) Process in small batches to be polite
  const batchSize = 10;
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    await Promise.all(
      chunk.map(async (r) => {
        const pageUrl = preferUrl(r.canonical_url, r.url);
        if (!pageUrl) { skipped++; return; }

        let html: string | null = null;
        try {
          html = await fetch(pageUrl, { redirect: "follow" }).then(x => x.text());
        } catch {
          failed++; return;
        }

        const resolved = resolvePublished({
          url: pageUrl,
          html,
          nowIso: new Date().toISOString(),
        });

        const iso = resolved.published_at ?? null;
        if (!iso) { skipped++; return; }

        // Normalize source to your CHECK list (map "text"/"relative" to "meta")
        const srcRaw = resolved.published_source ?? null;
        const allowed = new Set([
          "rss","atom","dc","jsonld","og","meta","time-tag","url","sitemap","modified",
        ]);
        const src = srcRaw && allowed.has(srcRaw) ? srcRaw : (srcRaw ? "meta" : null);

        if (dryRun) { updated++; touchedIds.push(r.id); return; }

        const updSql = `
          UPDATE articles
          SET published_at = $2::timestamptz,
              published_raw = NULLIF($3::text,''),
              published_source = NULLIF($4::text,''),
              published_confidence = $5::int,
              published_tz = NULLIF($6::text,'')
          WHERE id = $1
        `;
        const params = [
          r.id,
          iso,
          resolved.published_raw ?? null,
          src,
          resolved.published_confidence ?? null,
          resolved.published_tz ?? null,
        ] as const;

        try {
          await dbQuery(updSql, [...params]);
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
