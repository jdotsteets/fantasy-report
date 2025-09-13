import type { Adapters, IngestDecision } from "./types";

function isPromise<T>(v: unknown): v is Promise<T> {
  return !!v && typeof (v as { then?: unknown }).then === "function";
}

function normalizeDecision(v: unknown): IngestDecision {
  const kind = (v as { kind?: unknown }).kind;
  const reason = (v as { reason?: unknown }).reason;
  const section = (v as { section?: unknown }).section;
  const k = (kind === "article" || kind === "index" || kind === "skip") ? kind : "article";
  return { kind: k, ...(typeof reason === "string" ? { reason } : {}), ...(typeof section === "string" ? { section } : {}) };
}

export async function loadAdapters(): Promise<Adapters> {
  let extractCanonicalUrl: Adapters["extractCanonicalUrl"];
  let scrapeArticle: Adapters["scrapeArticle"];
  let routeByUrl: Adapters["routeByUrl"];
  try {
    const modUnknown: unknown = await import("../sources/adapters");
    const mod = modUnknown as Record<string, unknown>;
    if (typeof mod["scrapeArticle"] === "function") scrapeArticle = mod["scrapeArticle"] as Adapters["scrapeArticle"];
    if (typeof mod["extractCanonicalUrl"] === "function") extractCanonicalUrl = mod["extractCanonicalUrl"] as Adapters["extractCanonicalUrl"];
    if (typeof mod["routeByUrl"] === "function") {
      const raw = mod["routeByUrl"] as (...args: unknown[]) => unknown;
      routeByUrl = async (url: string) => normalizeDecision(isPromise(raw(url)) ? await raw(url) : raw(url));
    }
  } catch { /* optional */ }
  return { extractCanonicalUrl, scrapeArticle, routeByUrl };
}
