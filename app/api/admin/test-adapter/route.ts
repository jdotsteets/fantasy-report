// app/api/admin/test-adapter/route.ts
import { NextRequest } from "next/server";
import { ADAPTERS } from "@/lib/sources/adapters";
import type { SourceAdapter } from "@/lib/sources/types";

type AdapterConfig = {
  pageCount?: number;
  daysBack?: number;
  limit?: number;
  headers?: Record<string, string>;
};

type IndexHit = { url: string };

type ArticleInfo = {
  url: string;
  title: string;
  description?: string;
  imageUrl?: string;
  author?: string;
  publishedAt?: string;
};

type GetIndex0 = () => Promise<IndexHit[]>;
type GetIndex1 = (config?: AdapterConfig) => Promise<IndexHit[]>;
type GetIndex2 = (pages?: number, config?: AdapterConfig) => Promise<IndexHit[]>;

type GetArticle1 = (u: string) => Promise<ArticleInfo>;
type GetArticle2 = (u: string, config?: AdapterConfig) => Promise<ArticleInfo>;


async function callGetIndex(
  adapter: SourceAdapter,
  pageCount: number,
  cfg?: AdapterConfig
): Promise<IndexHit[]> {
  const fn = (adapter as { getIndex?: unknown }).getIndex;
  if (typeof fn !== "function") throw new Error("adapter missing getIndex");

  // Use declared parameter count to choose a compatible call
  const arity = fn.length;
  if (arity === 0) return (fn as GetIndex0)();
  if (arity === 1) return (fn as GetIndex1)(cfg);
  return (fn as GetIndex2)(pageCount, cfg);
}

async function callGetArticle(
  adapter: SourceAdapter,
  url: string,
  cfg?: AdapterConfig
): Promise<ArticleInfo> {
  const fn = (adapter as { getArticle?: unknown }).getArticle;
  if (typeof fn !== "function") throw new Error("adapter missing getArticle");

  const arity = fn.length;
  // Some adapters only take (url); others take (url, config)
  if (arity <= 1) return (fn as GetArticle1)(url);
  return (fn as GetArticle2)(url, cfg);
}


/* ───────────────────────── Utilities ───────────────────────── */

function okAuth(req: NextRequest): boolean {
  const key = (process.env.NEXT_PUBLIC_ADMIN_KEY ?? process.env.ADMIN_KEY ?? "").trim();
  if (!key) return true;
  return (req.headers.get("x-admin-key") ?? "").trim() === key;
}

type AdapterMap =
  | Readonly<Record<string, SourceAdapter>>
  | ReadonlyArray<SourceAdapter & { key?: string }>;

function isAdapterArray(v: unknown): v is ReadonlyArray<SourceAdapter & { key?: string }> {
  return Array.isArray(v);
}

function isAdapterRecord(v: unknown): v is Readonly<Record<string, SourceAdapter>> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function getAdapterByKey(key: string): SourceAdapter | undefined {
  const src = ADAPTERS as unknown as AdapterMap;

  if (isAdapterArray(src)) {
    const target = key.toLowerCase();
    return src.find(a => (a.key ?? "").toLowerCase() === target);
  }
  if (isAdapterRecord(src)) {
    return src[key];
  }
  return undefined;
}




function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/* ───────────────────────── Route ───────────────────────── */

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
      return Response.json({ ok: false, error: "scraper_key required" }, { status: 400 });
    }

    const adapter = getAdapterByKey(key);
    if (!adapter) {
      return Response.json(
        { ok: false, error: `unknown adapter "${key}"` },
        { status: 400 }
      );
    }

    // Config + defaults
    const cfg: AdapterConfig = body.adapter_config ?? {};
    const pageCount = Number(body.pageCount ?? cfg.pageCount ?? 2) || 2;
    const limitRaw = Number(body.limit ?? cfg.limit ?? 20) || 20;
    const limit = Math.max(1, Math.min(limitRaw, 50));

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
  } catch (e: unknown) {
    return Response.json({ ok: false, error: toMessage(e) }, { status: 400 });
  }
}
