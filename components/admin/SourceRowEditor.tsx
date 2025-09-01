"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type SourceRow = {
  id: number;
  name: string | null;
  homepage_url: string | null;
  rss_url: string | null;
  sitemap_url: string | null;
  favicon_url: string | null;
  allowed: boolean | null;
  priority: number | null;
  created_at: string | null;
  category: string | null;
  sport: string | null;
  notes: string | null;
  scrape_path: string | null;
  scrape_selector: string | null;
  paywall: boolean | null;
  scraper_key?: string | null;
  adapter_config?: Record<string, unknown> | null;
  fetch_mode?: "auto" | "rss" | "adapter" | null;
};

type SavePayload = Partial<
  Pick<
    SourceRow,
    "id" | "name" | "rss_url" | "homepage_url" | "scraper_key" | "fetch_mode" | "adapter_config"
  >
>;

/* Strict JSON parser for adapter_config */
function parseAdapterConfig(
  text: string
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  try {
    const trimmed = text.trim();
    if (!trimmed) return { ok: true, value: {} };
    const obj = JSON.parse(trimmed);
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      return { ok: true, value: obj as Record<string, unknown> };
    }
    return { ok: false, error: "Config must be a JSON object (not array/string)." };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/* Robust fetch — supports several possible API shapes */
async function fetchSource(id: number): Promise<SourceRow | null> {
  const res = await fetch(`/api/admin/sources?id=${id}`, { cache: "no-store" });
  if (!res.ok) return null;
  const data = await res.json();

  if (data && typeof data === "object" && "source" in data) {
    return (data as { source?: SourceRow }).source ?? null;
  }
  if (Array.isArray(data)) {
    const hit = (data as SourceRow[]).find((r) => r.id === id);
    return hit ?? null;
  }
  if (data && typeof data === "object" && "items" in data) {
    const items = (data as { items?: SourceRow[] }).items ?? [];
    return items.find((r) => r.id === id) ?? null;
  }
  if (data && typeof data === "object" && "rows" in data) {
    const rows = (data as { rows?: SourceRow[] }).rows ?? [];
    return rows.find((r) => r.id === id) ?? null;
  }
  return null;
}

export default function SourceRowEditor() {
  const [id, setId] = useState<number | "">("");
  const [loading, setLoading] = useState(false);
  const [src, setSrc] = useState<SourceRow | null>(null);

  // for Test Ingest UX
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  // keep a ref of "is editor open?" so global listeners don't need to rebind
  const isOpenRef = useRef(false);
  useEffect(() => {
    isOpenRef.current = !!src;
  }, [src]);

  const nameRef = useRef<HTMLInputElement>(null);
  const rssRef = useRef<HTMLInputElement>(null);
  const homeRef = useRef<HTMLInputElement>(null);
  const keyRef = useRef<HTMLInputElement>(null);
  const modeRef = useRef<HTMLSelectElement>(null);
  const cfgRef = useRef<HTMLTextAreaElement>(null);

  const loadById = async (theId: number) => {
    setLoading(true);
    try {
      const s = await fetchSource(theId);
      setSrc(s);
      setTestResult(null); // reset any previous test result
    } finally {
      setLoading(false);
    }
  };

  const closeEditor = () => {
    setSrc(null);
    setId("");
    setTesting(false);
    setTestResult(null);
    history.replaceState(null, "", location.pathname + location.search);
  };

  // Sync from hash on mount; keep listeners stable (no deps!)
  useEffect(() => {
    const syncFromHash = (explicitId?: number) => {
      const nextId =
        explicitId ??
        Number((window.location.hash.match(/source-(\d+)/)?.[1] ?? "0"));
      if (Number.isFinite(nextId) && nextId > 0) {
        setId(nextId);
        void loadById(nextId);
      }
    };

    // initial load
    syncFromHash();

    const onHash = () => syncFromHash();
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ id: number }>).detail;
      if (detail?.id) syncFromHash(detail.id);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpenRef.current) closeEditor();
    };

    window.addEventListener("hashchange", onHash);
    window.addEventListener("source:open", onOpen as EventListener);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("source:open", onOpen as EventListener);
      window.removeEventListener("keydown", onEsc);
    };
  }, []); // <-- important: never changes size

  const cfgText = useMemo(
    () => (src?.adapter_config ? JSON.stringify(src.adapter_config, null, 2) : ""),
    [src?.adapter_config]
  );

  // populate/clear inputs when src changes
  useEffect(() => {
    const set = (
      el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null,
      v: string
    ) => {
      if (el) el.value = v;
    };

    if (src) {
      set(nameRef.current, src.name ?? "");
      set(rssRef.current, src.rss_url ?? "");
      set(homeRef.current, src.homepage_url ?? "");
      set(keyRef.current, src.scraper_key ?? "");
      set(modeRef.current, (src.fetch_mode ?? "auto") as string);
      set(cfgRef.current, cfgText);
    } else {
      set(nameRef.current, "");
      set(rssRef.current, "");
      set(homeRef.current, "");
      set(keyRef.current, "");
      set(modeRef.current, "auto");
      set(cfgRef.current, "");
    }
  }, [src, cfgText]);

  // POST /api/admin/ingest for this source
  async function onTestIngestClick() {
    if (!src) return;
    setTesting(true);
    setTestResult(null);
    try {
      const qs = new URLSearchParams({ sourceId: String(src.id) });
      const res = await fetch(`/api/admin/ingest?${qs.toString()}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: 50, includeHealth: true }),
      });

      const j = await res.json().catch(() => ({} as any));
      if (res.ok) {
        const msg = `OK — inserted=${j.inserted ?? 0}, updated=${j.updated ?? 0}, skipped=${j.skipped ?? 0}`;
        setTestResult(msg);
      } else {
        setTestResult(`Failed (${res.status}) — ${j.error ?? res.statusText}`);
      }
    } catch (e) {
      setTestResult(`Failed — ${(e as Error).message}`);
    } finally {
      setTesting(false);
    }
  }

  return (
    <section id="source-editor" className="rounded-xl border p-3">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-semibold">Edit Source</h3>
        {src ? (
          <button
            onClick={closeEditor}
            className="h-8 rounded border px-3 text-sm hover:bg-zinc-50"
            title="Close editor"
          >
            Close
          </button>
        ) : null}
      </div>

      <div className="mb-3 flex items-center gap-2">
        <label className="text-sm text-zinc-600">source_id</label>
        <input
          value={id}
          onChange={(e) => setId(e.target.value ? Number(e.target.value) : "")}
          type="number"
          className="h-8 w-28 rounded border px-2 text-sm"
          placeholder="123"
        />
        <button
          onClick={() => {
            if (typeof id === "number" && Number.isFinite(id) && id > 0) {
              void loadById(id);
              window.location.hash = `source-${id}`;
            }
          }}
          className="h-8 rounded border px-3 text-sm hover:bg-zinc-50"
        >
          Load
        </button>
      </div>

      {loading && <div className="text-sm text-zinc-600">Loading…</div>}

      {src && (
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const payload: SavePayload = { id: src.id };

            if (nameRef.current) {
              const nm = nameRef.current.value.trim();
              payload.name = nm.length > 0 ? nm : null;
            }
            if (rssRef.current) payload.rss_url = rssRef.current.value || null;
            if (homeRef.current) payload.homepage_url = homeRef.current.value || null;
            if (keyRef.current) payload.scraper_key = keyRef.current.value || null;
            if (modeRef.current)
              payload.fetch_mode = (modeRef.current.value as SourceRow["fetch_mode"]) ?? null;

            let cfg: SavePayload["adapter_config"] = null;
            if (cfgRef.current) {
              const parsed = parseAdapterConfig(cfgRef.current.value);
              if (!parsed.ok) {
                alert(`Invalid adapter_config: ${parsed.error}`);
                return;
              }
              cfg = parsed.value;
            }
            payload.adapter_config = cfg;

            const resp = await fetch("/api/admin/sources", {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(payload),
            });

            if (!resp.ok) {
              const j = (await resp.json().catch(() => ({}))) as { error?: string };
              alert(`Save failed: ${j.error ?? resp.statusText}`);
              return;
            }

            // auto-close after a successful save
            closeEditor();
          }}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <div className="mb-1 text-zinc-600">Source Name</div>
              <input
                ref={nameRef}
                defaultValue={src.name ?? ""}
                className="w-full rounded border px-2 py-1"
                placeholder="Source name"
              />
            </label>

            <label className="text-sm">
              <div className="mb-1 text-zinc-600">Homepage URL</div>
              <input
                ref={homeRef}
                defaultValue={src.homepage_url ?? ""}
                className="w-full rounded border px-2 py-1"
                placeholder="https://…"
              />
            </label>

            <label className="text-sm">
              <div className="mb-1 text-zinc-600">RSS URL</div>
              <input
                ref={rssRef}
                defaultValue={src.rss_url ?? ""}
                className="w-full rounded border px-2 py-1"
                placeholder="https://…/feed"
              />
            </label>

            <label className="text-sm">
              <div className="mb-1 text-zinc-600">Fetch Mode</div>
              <select
                ref={modeRef}
                defaultValue={src.fetch_mode ?? "auto"}
                className="w-full rounded border px-2 py-1"
              >
                <option value="auto">auto (rss → adapter)</option>
                <option value="rss">rss only</option>
                <option value="adapter">adapter only</option>
              </select>
            </label>

            <label className="text-sm">
              <div className="mb-1 text-zinc-600">Scraper Key</div>
              <input
                ref={keyRef}
                defaultValue={src.scraper_key ?? ""}
                className="w-full rounded border px-2 py-1 font-mono"
                placeholder="fantasylife"
              />
            </label>
          </div>

          <label className="block text-sm">
            <div className="mb-1 text-zinc-600">Adapter Config (JSON)</div>
            <textarea
              ref={cfgRef}
              defaultValue={cfgText}
              className="h-40 w-full rounded border px-2 py-1 font-mono text-xs"
              placeholder={`{\n  "pageCount": 2,\n  "daysBack": 14,\n  "limit": 500\n}`}
            />
            <div className="mt-1 text-xs text-zinc-500">
              Keys understood by the current adapter: <code>pageCount</code>,{" "}
              <code>daysBack</code>, <code>limit</code>, <code>headers</code>.
            </div>
          </label>

          <div className="flex items-center gap-2">
            <button className="rounded border px-3 py-1.5 text-sm hover:bg-zinc-50">
              Save
            </button>

            <button
              type="button"
              onClick={onTestIngestClick}
              className="rounded border px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-60"
              disabled={testing}
              title="Run a one-off ingest for this source (limit 50)"
            >
              {testing ? "Testing…" : "Test Ingest"}
            </button>

            {testResult ? (
              <span className="text-xs text-zinc-600">{testResult}</span>
            ) : null}
          </div>
        </form>
      )}

      {!loading && !src && typeof id === "number" && id > 0 && (
        <div className="text-sm text-rose-700">No source with id {id}.</div>
      )}
    </section>
  );
}
