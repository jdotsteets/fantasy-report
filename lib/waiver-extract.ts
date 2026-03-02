// app/api/admin/waivers-backfill/route.ts
import { NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { getExtractor } from "@/lib/site-extractors";
import { mapPlayers } from "@/lib/site-extractors/mapPlayers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Art = { id: number; source_id: number; title: string | null; url: string | null };
type WaiverHit = { name: string; hint?: string; section?: string };
type MappedPlayer = { player_id: string; full_name: string; from_hint?: string };

function asInt(n: unknown) { return Number.isFinite(n) ? (n as number) : undefined; }

async function fetchHtml(url: string, timeoutMs = 12_000): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const resp = await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (content fetch for indexing)",
        "accept": "text/html,*/*",
        "accept-language": "en-US,en;q=0.9",
      },
    });
    clearTimeout(t);
    if (!resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const week = Number(searchParams.get("week") ?? "");
  const batchSize = Number(searchParams.get("batch") ?? "20");
  const host = (searchParams.get("host") ?? "").toLowerCase().trim() || null;
  const onlyArticleId = Number(searchParams.get("article_id") ?? "") || null;
  const debug = (searchParams.get("debug") ?? "0") === "1";
  const fpStatic = (searchParams.get("fp_static") ?? "0") === "1";
  const parallelFetch = 6;

  if (!Number.isFinite(week) || week <= 0) {
    return NextResponse.json({ ok: false, error: "Provide ?week=N" }, { status: 400 });
  }
  if (!Number.isFinite(batchSize) || batchSize < 1 || batchSize > 100) {
    return NextResponse.json({ ok: false, error: "Provide ?batch=1..100" }, { status: 400 });
  }

  // -------- 1) Build article scope (FantasyPros static override supported)
  let articles: Art[] = [];
  let totalArts = 0;

  if (fpStatic) {
    // Resolve the FantasyPros source_id (fallback to 0 if not present)
    const srcRes = await dbQuery<{ id: number }>(
      `SELECT id FROM sources WHERE lower(coalesce(homepage_url,'')) LIKE '%fantasypros.com%' ORDER BY id LIMIT 1`
    );
    const fpSourceId = srcRes.rows?.[0]?.id ?? 0;

    // Use provided article_id (for traceability) or a synthetic negative id
    const virtualId = onlyArticleId ?? -1159773;

    articles = [{
      id: virtualId,
      source_id: fpSourceId,
      title: "FantasyPros Waiver Wire Rankings (static)",
      url: "https://www.fantasypros.com/nfl/rankings/waiver-wire-half-point-ppr-overall.php",
    }];
    totalArts = 1;
  } else {
    const artsRes = await dbQuery<Art>(
      `
      SELECT id, source_id, title, url
      FROM articles
      WHERE primary_topic = 'waiver-wire'
        AND week = $1
        AND COALESCE(is_static,false) = false
        AND COALESCE(is_player_page,false) = false
        ${host ? `AND (lower(coalesce(url,'')) LIKE '%' || $2 || '%' OR lower(coalesce(canonical_url,'')) LIKE '%' || $2 || '%')` : ""}
        ${onlyArticleId ? `AND id = ${onlyArticleId}` : ""}
      ORDER BY published_at DESC NULLS LAST, id DESC
      `,
      host ? [week, host] : [week]
    );
    articles = artsRes.rows ?? [];
    totalArts = articles.length;
  }

  // -------- Debug counters/collectors
  let fetched = 0;
  let extracted = 0;
  let mappedCnt = 0;
  let insertedNow = 0;

  const unmappedNames: Array<{ name: string; hint?: string; section?: string; article_id: number }> = [];
  const mappedExamples: Array<{ player_id: string; full_name: string; article_id: number }> = [];

  // -------- 2) Process
  await dbQuery(`BEGIN; SET LOCAL statement_timeout = '0';`);
  try {
    for (let i = 0; i < articles.length; i += batchSize) {
      const slice = articles.slice(i, i + batchSize);
      const rowsToInsert: Array<{
        week: number;
        article_id: number;
        source_id: number;
        player_id: string;
        player_key: string;
        player_name: string;
        confidence: number;
        from_hint: string;
      }> = [];

      for (let j = 0; j < slice.length; j += parallelFetch) {
        const group = slice.slice(j, j + parallelFetch);

        const groupResults = await Promise.all(
          group.map(async (a) => {
            if (!a.url) return { a, html: null as string | null };
            const html = await fetchHtml(a.url);
            if (html) fetched++;
            return { a, html };
          })
        );

        for (const { a, html } of groupResults) {
          if (!html || !a.url) continue;

          // Run the site-specific extractor
          let hits: WaiverHit[] = [];
          try {
            const extractor = getExtractor(new URL(a.url));
            hits = (extractor(html, new URL(a.url)) ?? []) as WaiverHit[];
          } catch {
            hits = [];
          }
          if (hits.length) extracted += hits.length;

          // Map names -> players
          let mapped: MappedPlayer[] = [];
          try {
            mapped = await mapPlayers(hits);
          } catch {
            mapped = [];
          }
          if (mapped.length) mappedCnt += mapped.length;

          // Debug samples
          if (debug) {
            const mappedSet = new Set(mapped.map(m => m.full_name.toLowerCase()));
            for (const h of hits) {
              const key = h.name.toLowerCase();
              const wasMapped = Array.from(mappedSet).some(mn =>
                mn.endsWith(" " + (key.split(/\s+/).pop() ?? ""))
              );
              if (!wasMapped) unmappedNames.push({ name: h.name, hint: h.hint, section: h.section, article_id: a.id });
            }
            for (const m of mapped.slice(0, 3)) {
              mappedExamples.push({ player_id: m.player_id, full_name: m.full_name, article_id: a.id });
            }
          }

          // Per-article de-dupe
          const seen = new Set<string>();
          for (const m of mapped) {
            if (!m.player_id || seen.has(m.player_id)) continue;
            seen.add(m.player_id);
            rowsToInsert.push({
              week,
              article_id: a.id,
              source_id: a.source_id,
              player_id: m.player_id,
              player_key: m.player_id,
              player_name: m.full_name,
              confidence: 1.0,
              from_hint: m.from_hint ?? "site-extractor",
            });
          }
        }
      }

      if (rowsToInsert.length) {
        const ins = await dbQuery<{ inserted: number }>(
          `
          WITH m AS (
            SELECT * FROM jsonb_to_recordset($1::jsonb)
            AS x(
              week int,
              article_id bigint,
              source_id int,
              player_id text,
              player_key text,
              player_name text,
              confidence real,
              from_hint text
            )
          ),
          ins AS (
            INSERT INTO waiver_mentions
              (week, article_id, source_id, player_id, player_key, player_name, confidence)
            SELECT week, article_id, source_id, player_id, player_key, player_name, confidence
            FROM m
            ON CONFLICT (week, source_id, player_id) DO NOTHING
            RETURNING 1
          )
          SELECT COUNT(*)::int AS inserted FROM ins;
          `,
          [JSON.stringify(rowsToInsert)]
        );
        insertedNow += Number(asInt(ins.rows?.[0]?.inserted) ?? 0);
      }
    }

    await dbQuery(`COMMIT;`);
  } catch (err) {
    try { await dbQuery(`ROLLBACK;`); } catch {}
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }

  // -------- 3) Totals + response
  const totals = await dbQuery<{ mentions_total: number }>(
    `SELECT COUNT(*)::int AS mentions_total FROM waiver_mentions WHERE week = $1`,
    [week]
  );

  const resp: any = {
    ok: true,
    scope: { week, batchSize, host, article_id: onlyArticleId, fp_static: fpStatic, debug },
    articles_scanned: totalArts,
    fetched,
    extracted,
    mapped: mappedCnt,
    mentions_total: Number(asInt(totals.rows?.[0]?.mentions_total) ?? 0),
    inserted_now: insertedNow,
  };

  if (debug) {
    const uniqUnmapped = new Map<string, { name: string; hint?: string; section?: string; article_id: number }>();
    for (const u of unmappedNames) {
      const k = `${u.article_id}::${u.name.toLowerCase()}`;
      if (!uniqUnmapped.has(k)) uniqUnmapped.set(k, u);
      if (uniqUnmapped.size >= 25) break;
    }
    resp.unmapped_examples = Array.from(uniqUnmapped.values());
    resp.mapped_examples = mappedExamples.slice(0, 15);
  }

  return NextResponse.json(resp);
}
