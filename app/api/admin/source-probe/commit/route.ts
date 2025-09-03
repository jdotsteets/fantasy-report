// app/api/admin/source-probe/commit/route.ts
import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "@/lib/db";
import type { ProbeMethod } from "@/lib/sources/types";

type CommitBody = {
  url: string;
  method: ProbeMethod;
  feedUrl?: string | null;
  selector?: string | null;
  nameHint?: string | null;
  adapterKey?: string | null;
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function normalizeHomepage(u: URL): string {
  const v = new URL(u.toString());
  v.hash = "";
  v.search = "";
  if (v.protocol !== "https:") v.protocol = "https:";
  // keep a trailing slash for stable uniqueness, normalize path to root
  v.pathname = "/";
  return v.toString();
}

async function findExisting(homepage: string, name: string) {
  // match by homepage origin OR by name
  const row = (
    await dbQuery<{ id: number }>(
      `
      SELECT id
      FROM sources
      WHERE homepage_url ILIKE $1::text
         OR name ILIKE $2::text
      LIMIT 1
      `,
      [homepage, name]
    )
  ).rows[0];
  return row?.id ?? null;
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as CommitBody;

  const page = new URL(body.url);
  const homepage = normalizeHomepage(page);
  const name = (body.nameHint ?? page.host).trim();
  const method = body.method;

  try {
    const existingId = await findExisting(homepage, name);

    if (method === "rss") {
      const rssUrl = (body.feedUrl ?? "").trim();
      if (!rssUrl) {
        return NextResponse.json({ error: "Missing feedUrl" }, { status: 400 });
      }

      if (existingId) {
        const row = (
          await dbQuery<{ id: number }>(
            `
            UPDATE sources
               SET name         = $1::text,
                   homepage_url = $2::text,
                   rss_url      = $3::text,
                   allowed      = COALESCE(allowed, TRUE)
             WHERE id = $4::int
             RETURNING id
            `,
            [name, homepage, rssUrl, existingId]
          )
        ).rows[0];
        return NextResponse.json({ ok: true, sourceId: row.id });
      }

      const row = (
        await dbQuery<{ id: number }>(
          `
          INSERT INTO sources (name, homepage_url, rss_url, allowed)
          VALUES ($1::text, $2::text, $3::text, TRUE)
          ON CONFLICT (homepage_url) DO UPDATE SET
            name    = EXCLUDED.name,
            rss_url = EXCLUDED.rss_url,
            allowed = COALESCE(sources.allowed, TRUE)
          RETURNING id
          `,
          [name, homepage, rssUrl]
        )
      ).rows[0];
      return NextResponse.json({ ok: true, sourceId: row.id });
    }

    if (method === "scrape") {
      const selector = (body.selector ?? "").trim();
      if (!selector) {
        return NextResponse.json({ error: "Missing selector" }, { status: 400 });
      }

      if (existingId) {
        const row = (
          await dbQuery<{ id: number }>(
            `
            UPDATE sources
               SET name            = $1::text,
                   homepage_url    = $2::text,
                   scrape_selector = $3::text,
                   allowed         = COALESCE(allowed, TRUE)
             WHERE id = $4::int
             RETURNING id
            `,
            [name, homepage, selector, existingId]
          )
        ).rows[0];
        return NextResponse.json({ ok: true, sourceId: row.id });
      }

      const row = (
        await dbQuery<{ id: number }>(
          `
          INSERT INTO sources (name, homepage_url, scrape_selector, allowed)
          VALUES ($1::text, $2::text, $3::text, TRUE)
          ON CONFLICT (homepage_url) DO UPDATE SET
            name            = EXCLUDED.name,
            scrape_selector = EXCLUDED.scrape_selector,
            allowed         = COALESCE(sources.allowed, TRUE)
          RETURNING id
          `,
          [name, homepage, selector]
        )
      ).rows[0];
      return NextResponse.json({ ok: true, sourceId: row.id });
    }

    if (method === "adapter") {
      const adapterKey = (body.adapterKey ?? "").trim();
      if (!adapterKey) {
        return NextResponse.json({ error: "Missing adapterKey" }, { status: 400 });
      }

      if (existingId) {
        const row = (
          await dbQuery<{ id: number }>(
            `
            UPDATE sources
               SET name           = $1::text,
                   homepage_url   = $2::text,
                   adapter_config = COALESCE(adapter_config, '{}'::jsonb)
                                     || jsonb_build_object('adapter', $3::text),
                   allowed        = COALESCE(allowed, TRUE)
             WHERE id = $4::int
             RETURNING id
            `,
            [name, homepage, adapterKey, existingId]
          )
        ).rows[0];
        return NextResponse.json({ ok: true, sourceId: row.id });
      }

      const row = (
        await dbQuery<{ id: number }>(
          `
          INSERT INTO sources (name, homepage_url, adapter_config, allowed)
          VALUES ($1::text, $2::text, jsonb_build_object('adapter', $3::text), TRUE)
          ON CONFLICT (homepage_url) DO UPDATE SET
            name           = EXCLUDED.name,
            adapter_config = COALESCE(sources.adapter_config, '{}'::jsonb)
                               || jsonb_build_object('adapter', EXCLUDED.adapter_config->>'adapter'),
            allowed        = COALESCE(sources.allowed, TRUE)
          RETURNING id
          `,
          [name, homepage, adapterKey]
        )
      ).rows[0];
      return NextResponse.json({ ok: true, sourceId: row.id });
    }

    return NextResponse.json({ error: `Unsupported method: ${method}` }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
