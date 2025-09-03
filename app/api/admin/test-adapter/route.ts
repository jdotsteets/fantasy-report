// app/api/admin/test-adapter/route.ts
import { NextRequest } from "next/server";
// If your adapter map lives in "@/lib/sources":
import { ADAPTERS } from "@/lib/sources/adapters";
// If instead you keep them in "@/lib/source/adapters", swap the import:
// import { ADAPTERS as ADAPTERS } from "@/lib/source/adapters";

import type { SourceAdapter } from "@/lib/sources/types";

type AdapterConfig = {
  pageCount?: number;
  daysBack?: number;
  limit?: number;
  headers?: Record<string, string>;
};

function okAuth(req: NextRequest) {
  // Optional guard (matches SourceRowEditor + ingest routes)
  const key =
    (process.env.NEXT_PUBLIC_ADMIN_KEY ?? process.env.ADMIN_KEY ?? "").trim();
  if (!key) return true;
  return (req.headers.get("x-admin-key") ?? "").trim() === key;
}

function getAdapterByKey(
  key: string
): SourceAdapter | undefined {
  const anyAdapters: any = ADAPTERS as any;

  if (Array.isArray(anyAdapters)) {
    // array of adapters with a 'key' property
    return anyAdapters.find(
      (a: any) => (a?.key ?? "").toLowerCase() === key
    ) as SourceAdapter | undefined;
  }

  // dictionary/object form
  const dict = anyAdapters as Record<string, SourceAdapter | undefined>;
  return dict[key];
}


async function callGetIndex(
  adapter: SourceAdapter,
  pageCount: number,
  cfg?: AdapterConfig
) {
  const fn = adapter.getIndex as (
    pages?: number,
    config?: AdapterConfig
  ) => Promise<Array<{ url: string }>>;
  return typeof cfg === "undefined" ? fn(pageCount) : fn(pageCount, cfg);
}

async function callGetArticle(
  adapter: SourceAdapter,
  url: string,
  cfg?: AdapterConfig
) {
  const fn = adapter.getArticle as (
    u: string,
    config?: AdapterConfig
  ) => Promise<{
    url: string;
    title: string;
    description?: string;
    imageUrl?: string;
    author?: string;
    publishedAt?: string;
  }>;
  return typeof cfg === "undefined" ? fn(url) : fn(url, cfg);
}

export async function POST(req: NextRequest) {
  if (!okAuth(req)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as {
      scraper_key?: string;
      pageCount?: number;
      limit?: number;
      adapter_config?: AdapterConfig;
    };

    const key = String(body.scraper_key ?? "").trim().toLowerCase();
    if (!key) {
      return Response.json(
        { ok: false, error: "scraper_key required" },
        { status: 400 }
      );
    }

    const adapter = getAdapterByKey(key);
    if (!adapter) {
      return Response.json(
        { ok: false, error: `unknown adapter "${key}"` },
        { status: 400 }
      );
    }

    
    // Config + defaults
    const cfg = (body.adapter_config ?? {}) as AdapterConfig;
    const pageCount = Number(body.pageCount ?? cfg.pageCount ?? 2) || 2;
    // cap preview to avoid hammering the site
    const limit = Math.max(
      1,
      Math.min(Number(body.limit ?? cfg.limit ?? 20) || 20, 50)
    );

    // 1) Index
    const hits = await callGetIndex(adapter, pageCount, cfg);

    // 2) Enrich a small sample
    const sample: Array<{ url: string; title?: string }> = [];
    for (const h of hits.slice(0, limit)) {
      try {
        const art = await callGetArticle(adapter, h.url, cfg);
        sample.push({ url: art.url, title: art.title });
      } catch {
        // skip bad URL, keep preview resilient
      }
    }

    return Response.json({
      ok: true,
      totalFound: hits.length,
      sampleCount: sample.length,
      sample,
    });
  } catch (e: any) {
    return Response.json(
      { ok: false, error: e?.message ?? "invalid_input" },
      { status: 400 }
    );
  }
}
