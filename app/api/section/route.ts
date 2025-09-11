// app/api/section/route.ts
import { NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";

// Keep in sync with your Home sections
const KEYS = new Set(["rankings", "start-sit", "waiver-wire", "dfs", "injury", "advice", "news"] as const);
type SectionKey = typeof KEYS extends Set<infer T> ? T : never;

type DbRow = {
  id: number;
  title: string;
  url: string;
  canonical_url: string | null;
  domain: string;
  image_url: string | null;
  published_at: string | null;
  discovered_at: string | null;
  week: number | null;
  topics: string[] | null;
  source: string;
  provider: string | null;
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    const key = (url.searchParams.get("key") || "").toLowerCase().trim() as SectionKey;
    if (!KEYS.has(key)) {
      return NextResponse.json({ error: "invalid key" }, { status: 400 });
    }

    const days       = clampInt(url.searchParams.get("days"),   1, 2000, 45);
    const limit      = clampInt(url.searchParams.get("limit"),  1, 100,  10);
    const offset     = clampInt(url.searchParams.get("offset"), 0, 10_000, 0);
    const week       = toNullableInt(url.searchParams.get("week"));
    const sourceId   = toNullableInt(url.searchParams.get("sourceId"));
    const providerQS = (url.searchParams.get("provider") || "").trim();
    const provider   = providerQS.length ? providerQS : null;

    // ───────── NEWS ─────────
    if (key === "news") {
      const { rows } = await dbQuery<DbRow>(
        `
        WITH base AS (
          SELECT
            a.id,
            COALESCE(a.cleaned_title, a.title) AS title,
            a.url,
            a.canonical_url,
            a.domain,
            a.image_url,
            a.published_at,
            a.discovered_at,
            a.week,
            a.topics,
            s.name AS source,
            s.provider,
            COALESCE(a.published_at, a.discovered_at) AS order_ts
          FROM articles a
          JOIN sources s ON s.id = a.source_id
          WHERE
            (a.published_at >= NOW() - ($1::int || ' days')::interval
             OR a.discovered_at >= NOW() - ($1::int || ' days')::interval)
            AND a.is_static IS NOT TRUE
            AND a.is_player_page IS NOT TRUE
            AND NOT (a.domain ILIKE '%nbcsports.com%' AND a.url NOT ILIKE '%/nfl/%')
            AND (
              a.source_id NOT IN (3135,3138,3141) OR (
                COALESCE(a.cleaned_title, a.title) ILIKE '%nfl%' OR
                a.url ILIKE '%nfl%' OR
                COALESCE(a.cleaned_title, a.title) ILIKE '%fantasy%football%' OR
                a.url ILIKE '%fantasy%football%'
              )
            )
            AND ($4::int  IS NULL OR a.source_id = $4::int)
            AND ($5::text IS NULL OR s.provider = $5::text)
        ),
        ranked AS (
          SELECT *,
                 ROW_NUMBER() OVER (
                   PARTITION BY COALESCE(canonical_url, url)
                   ORDER BY order_ts DESC NULLS LAST, id DESC
                 ) AS rn
          FROM base
        )
        SELECT id, title, url, canonical_url, domain, image_url,
               published_at, discovered_at, week, topics, source, provider
        FROM ranked
        WHERE rn = 1
        ORDER BY order_ts DESC NULLS LAST, id DESC
        OFFSET $3::int
        LIMIT $2::int
        `,
        [days, limit, offset, sourceId ?? null, provider] // $1..$5
      );
      return NextResponse.json({ items: rows }, { status: 200 });
    }

    // ───────── TOPIC SECTIONS ─────────
    const topic = key;
    const { rows } = await dbQuery<DbRow>(
      `
      WITH base AS (
        SELECT
          a.id,
          COALESCE(a.cleaned_title, a.title) AS title,
          a.url,
          a.canonical_url,
          a.domain,
          a.image_url,
          a.published_at,
          a.discovered_at,
          a.week,
          a.topics,
          s.name AS source,
          s.provider,
          COALESCE(a.published_at, a.discovered_at) AS order_ts
        FROM articles a
        JOIN sources s ON s.id = a.source_id
        WHERE
          (a.published_at >= NOW() - ($1::int || ' days')::interval
           OR a.discovered_at >= NOW() - ($1::int || ' days')::interval)
          AND a.is_static IS NOT TRUE
          AND a.is_player_page IS NOT TRUE
          AND NOT (a.domain ILIKE '%nbcsports.com%' AND a.url NOT ILIKE '%/nfl/%')
          AND (
            a.source_id NOT IN (3135,3138,3141) OR
            COALESCE(a.cleaned_title, a.title) ILIKE '%nfl%' OR
            a.url ILIKE '%nfl%' OR
            COALESCE(a.cleaned_title, a.title) ILIKE '%fantasy%football%' OR
            a.url ILIKE '%fantasy%football%'
          )
          AND (
            a.primary_topic = $4
            OR a.primary_topic = REPLACE($4, '-', '_')
            OR ($4 = 'waiver-wire' AND a.primary_topic IN ('waiver', 'waiver_wire'))
          )
          AND ($5::int  IS NULL OR a.week = $5::int)
          AND ($6::int  IS NULL OR a.source_id = $6::int)
          AND ($7::text IS NULL OR s.provider = $7::text)
      )
      SELECT id, title, url, canonical_url, domain, image_url,
             published_at, discovered_at, week, topics, source, provider
      FROM base
      ORDER BY order_ts DESC NULLS LAST, id DESC
      OFFSET $3::int
      LIMIT $2::int
      `,
      [days, limit, offset, topic, week ?? null, sourceId ?? null, provider] // $1..$7
    );

    return NextResponse.json({ items: rows }, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/* utils */
function clampInt(raw: string | null, min: number, max: number, dflt: number) {
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}
function toNullableInt(raw: string | null): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}
