// app/api/admin/waivers-backfill/route.ts

import { NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import { getExtractor } from "@/lib/site-extractors";
import { mapPlayers } from "@/lib/site-extractors/mapPlayers";

// Ensure Node runtime
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// ---------- tiny types ----------
type WaiverHit = { name: string; hint?: string; section?: string };
type MappedPlayer = { player_id: string; full_name: string; from_hint?: string };
type Pos = "QB" | "RB" | "WR" | "TE" | "K" | "DST";
type Scoring = "HALF" | "PPR" | "STD";

type InsertRow = {
  week: number;
  article_id: number;
  source_id: number;
  player_id: string;
  player_key: string;
  player_name: string;
  confidence: number;
  from_hint?: string | null;
};

// ---------- helpers ----------
function asInt(n: unknown) {
  return Number.isFinite(n as number) ? (n as number) : undefined;
}

async function fetchFpHtml(u: string, timeoutMs = 12000): Promise<string | null> {
  const UAS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  ];
  for (const ua of UAS) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const r = await fetch(u, {
        signal: ctrl.signal,
        headers: {
          "user-agent": ua,
          "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.9",
        },
        redirect: "follow",
      });
      clearTimeout(t);
      if (!r.ok) continue;
      const txt = await r.text();
      if ((txt || "").length > 500) return txt;
    } catch {
      // try next UA
    }
  }
  return null;
}

function extractNamesFromFpHtml(html: string, pos?: string): WaiverHit[] {
  const out: WaiverHit[] = [];
  const seen = new Set<string>();
  const push = (name: string) => {
    const clean = (name || "")
      .replace(/\s+/g, " ")
      .replace(/\s[-–—]\s.*$/g, "")
      .replace(/,\s*[A-Z]{2,3}\b.*$/g, "")
      .trim();
    if (!clean || clean.split(/\s+/).length < 2) return;
    const key = clean.toLowerCase() + "|" + (pos ?? "");
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name: clean, hint: pos, section: "html" });
  };

  // 1) <tr data-player-name="...">
  {
    const rx = /<tr[^>]*data-player-name="([^"]+)"[^>]*>/gi;
    let m: RegExpExecArray | null;
    let any = false;
    while ((m = rx.exec(html)) !== null) {
      push(m[1]);
      any = true;
    }
    if (any) return out;
  }
  // 2) Anchors to /players/…
  {
    const rx = /<a[^>]+href="\/nfl\/players\/[^"]+"[^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    let any = false;
    while ((m = rx.exec(html)) !== null) {
      const nm = (m[1] || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (nm) {
        push(nm);
        any = true;
      }
    }
    if (any) return out;
  }
  // 3) Embedded JS blocks
  {
    const names = new Set<string>();
    const blocks = [
      html.match(/window\.__NUXT__\s*=\s*({[\s\S]*?});/i)?.[1],
      html.match(/ecrData\s*=\s*({[\s\S]*?});/i)?.[1],
      html.match(/"players"\s*:\s*\[([\s\S]*?)\]/i)?.[1],
    ].filter(Boolean) as string[];
    for (const b of blocks) {
      let m: RegExpExecArray | null;
      const nameJsonRx = /"name"\s*:\s*"([^"]+)"/gi;
      while ((m = nameJsonRx.exec(b)) !== null) names.add(m[1]);
      const nameJsRx = /\bname\s*:\s*['"]([^'"]+)['"]/gi;
      while ((m = nameJsRx.exec(b)) !== null) names.add(m[1]);
    }
    for (const nm of names) push(nm);
  }
  return out;
}

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

// ---------- handler ----------
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const week = Number(searchParams.get("week") ?? "");
  const batchSize = Number(searchParams.get("batch") ?? "20");
  const host = (searchParams.get("host") ?? "").toLowerCase().trim() || null;
  const onlyArticleId = Number(searchParams.get("article_id") ?? "") || null;
  const debug = (searchParams.get("debug") ?? "") === "1";
  const top = Math.max(1, Math.min(10, Number(searchParams.get("top") ?? "5"))); // cap 1..10
  const parallelFetch = 6;

  if (!Number.isFinite(week) || week <= 0) {
    return NextResponse.json({ ok: false, error: "Provide ?week=N" }, { status: 400 });
  }

  // ---------- FAST-PATH: FantasyPros static rankings (SSR only, top N) ----------
  const fpStatic = (searchParams.get("fp_static") ?? "") === "1";
  if (fpStatic) {
    const scoringParam = (searchParams.get("scoring") ?? "").toUpperCase();
    const scoring: Scoring =
      scoringParam === "PPR" ? "PPR" : scoringParam === "STD" ? "STD" : "HALF";

    const overallUrl = `https://www.fantasypros.com/nfl/rankings/?type=waiver&scoring=${scoring}`;
    const posPages: Array<{ url: string; pos: Pos }> = [
      { url: `https://www.fantasypros.com/nfl/rankings/?type=waiver&position=QB&scoring=${scoring}`, pos: "QB" },
      { url: `https://www.fantasypros.com/nfl/rankings/?type=waiver&position=RB&scoring=${scoring}`, pos: "RB" },
      { url: `https://www.fantasypros.com/nfl/rankings/?type=waiver&position=WR&scoring=${scoring}`, pos: "WR" },
      { url: `https://www.fantasypros.com/nfl/rankings/?type=waiver&position=TE&scoring=${scoring}`, pos: "TE" },
      { url: `https://www.fantasypros.com/nfl/rankings/?type=waiver&position=K&scoring=${scoring}`,  pos: "K"  },
      { url: `https://www.fantasypros.com/nfl/rankings/?type=waiver&position=DST&scoring=${scoring}`, pos: "DST" },
    ];

    type Step = { url: string; source: "html"; found: number; note?: string };
    const steps: Array<Step> = [];
    const hits: WaiverHit[] = [];

    const takeTop = (arr: WaiverHit[], pos?: Pos): WaiverHit[] => {
      const filtered = pos ? arr.filter(h => (h.hint ?? "").toUpperCase() === pos) : arr;
      return filtered.slice(0, top);
    };

    async function scrapeTop(url: string, pos?: Pos) {
      const html = await fetchFpHtml(url);
      if (!html) {
        steps.push({ url, source: "html", found: 0, note: "no-html" });
        return;
      }
      const all = extractNamesFromFpHtml(html, pos);
      const topN = takeTop(all, pos);
      steps.push({ url, source: "html", found: topN.length });
      hits.push(...topN.map(h => ({ ...h, section: "html" })));
    }

    // overall + positions
    await scrapeTop(overallUrl);
    for (const p of posPages) await scrapeTop(p.url, p.pos);

    // de-dup by name+pos
    const seen = new Set<string>();
    const deduped: WaiverHit[] = [];
    for (const h of hits) {
      const key = `${h.name.toLowerCase()}|${(h.hint ?? "").toUpperCase()}`;
      if (!seen.has(key)) { seen.add(key); deduped.push(h); }
    }

    const mapped = await mapPlayers(deduped).catch(() => [] as MappedPlayer[]);
    const srcId =
      (await dbQuery<{ id: number }>(
        `select id from sources where homepage_url ilike '%fantasypros.com%' limit 1`
      )).rows?.[0]?.id ?? 0;

    const uniqPlayers = new Set<string>();
    const rowsToInsert: InsertRow[] = mapped
      .filter((m) => m.player_id && !uniqPlayers.has(m.player_id) && uniqPlayers.add(m.player_id))
      .map((m) => ({
        week,
        article_id: Number(searchParams.get("article_id") ?? -1),
        source_id: srcId,
        player_id: m.player_id,
        player_key: m.player_id,
        player_name: m.full_name,
        confidence: 1.0,
        from_hint: m.from_hint ?? "fantasypros-ssr",
      }));

    let insertedNow = 0;
    if (rowsToInsert.length) {
      const ins = await dbQuery<{ inserted: number }>(
        `
        with m as (
          select * from jsonb_to_recordset($1::jsonb)
          as x(week int, article_id bigint, source_id int, player_id text, player_key text, player_name text, confidence real, from_hint text)
        ), ins as (
          insert into waiver_mentions (week, article_id, source_id, player_id, player_key, player_name, confidence)
          select week, article_id, source_id, player_id, player_key, player_name, confidence
          from m
          on conflict (week, source_id, player_id) do nothing
          returning 1
        )
        select count(*)::int as inserted from ins;
        `,
        [JSON.stringify(rowsToInsert)]
      );
      insertedNow = Number(ins.rows?.[0]?.inserted ?? 0);
    }

    const totals = await dbQuery<{ c: number }>(
      `select count(*)::int c from waiver_mentions where week=$1`,
      [week]
    );

    return NextResponse.json({
      ok: true,
      scope: {
        week,
        batchSize,
        host: null,
        article_id: Number(searchParams.get("article_id") ?? -1),
        debug,
        top,
        scoring,
      },
      articles_scanned: 0,
      fetched: 1 + posPages.length,
      extracted: deduped.length,
      mapped: mapped.length,
      mentions_total: Number(totals.rows?.[0]?.c ?? 0),
      inserted_now: insertedNow,
      debug: debug ? { steps, sample_hits: deduped.slice(0, 20), sample_mapped: mapped.slice(0, 10) } : undefined,
    });
  }

  // ---------- NORMAL ARTICLE FLOW (unchanged) ----------
  const artsRes = await dbQuery<{ id: number; source_id: number; title: string | null; url: string | null }>(
    `
    SELECT id, source_id, title, url
    FROM articles
    WHERE primary_topic = 'waiver-wire'
      AND week = $1
      AND COALESCE(is_static,false) = false
      AND COALESCE(is_player_page,false) = false
      ${host ? `AND (lower(coalesce(url,'')) like '%'||$2||'%' OR lower(coalesce(canonical_url,'')) like '%'||$2||'%')` : ""}
      ${onlyArticleId ? `AND id = ${onlyArticleId}` : ""}
    ORDER BY published_at DESC NULLS LAST, id DESC
    `,
    host ? [week, host] : [week]
  );

  const articles = artsRes.rows ?? [];
  const totalArts = articles.length;

  let fetched = 0;
  let extracted = 0;
  let mappedCnt = 0;
  let insertedNow = 0;

  await dbQuery(`BEGIN; SET LOCAL statement_timeout = '0';`);
  try {
    for (let i = 0; i < articles.length; i += batchSize) {
      const slice = articles.slice(i, i + batchSize);

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

          const extractor = getExtractor(new URL(a.url));
          const hits = ((extractor(html, new URL(a.url)) ?? []) as WaiverHit[]) || [];
          if (hits.length) extracted += hits.length;

          let mapped: MappedPlayer[] = [];
          try {
            mapped = await mapPlayers(hits);
          } catch {
            mapped = [];
          }
          if (mapped.length) mappedCnt += mapped.length;

          const seen = new Set<string>();
          const rowsToInsert: InsertRow[] = [];
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

          if (rowsToInsert.length) {
            const ins = await dbQuery<{ inserted: number }>(
              `
              with m as (
                select * from jsonb_to_recordset($1::jsonb)
                as x(week int, article_id bigint, source_id int, player_id text, player_key text, player_name text, confidence real, from_hint text)
              ), ins as (
                insert into waiver_mentions (week, article_id, source_id, player_id, player_key, player_name, confidence)
                select week, article_id, source_id, player_id, player_key, player_name, confidence
                from m
                on conflict (week, source_id, player_id) do nothing
                returning 1
              )
              select count(*)::int as inserted from ins;
              `,
              [JSON.stringify(rowsToInsert)]
            );
            insertedNow += Number(ins.rows?.[0]?.inserted ?? 0);
          }
        }
      }
    }
    await dbQuery(`COMMIT;`);
  } catch (err) {
    try {
      await dbQuery(`ROLLBACK;`);
    } catch {}
    return NextResponse.json(
      { ok: false, error: (err as Error)?.message || "Unknown error" },
      { status: 500 }
    );
  }

  const totals = await dbQuery<{ mentions_total: number }>(
    `SELECT COUNT(*)::int AS mentions_total FROM waiver_mentions WHERE week = $1`,
    [week]
  );

  return NextResponse.json({
    ok: true,
    scope: { week, batchSize, host, article_id: onlyArticleId },
    articles_scanned: totalArts,
    fetched,
    extracted,
    mapped: mappedCnt,
    mentions_total: Number(asInt(totals.rows?.[0]?.mentions_total) ?? 0),
    inserted_now: insertedNow,
  });
}
