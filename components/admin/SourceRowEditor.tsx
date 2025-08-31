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
    | "id"
    | "rss_url"
    | "homepage_url"
    | "scraper_key"
    | "fetch_mode"
    | "adapter_config"
  >
>;

function parseAdapterConfig(text: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  try {
    const obj = text.trim() ? JSON.parse(text) : {};
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      return { ok: true, value: obj as Record<string, unknown> };
    }
    return { ok: false, error: "Config must be a JSON object (not array/string)." };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function fetchSource(id: number): Promise<SourceRow | null> {
  const url = `/api/admin/sources?id=${id}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  const data = (await res.json()) as { source?: SourceRow };
  return data.source ?? null;
}

export default function SourceRowEditor() {
  const [id, setId] = useState<number | "">("");
  const [loading, setLoading] = useState(false);
  const [src, setSrc] = useState<SourceRow | null>(null);

  const rssRef = useRef<HTMLInputElement>(null);
  const homeRef = useRef<HTMLInputElement>(null);
  const keyRef = useRef<HTMLInputElement>(null);
  const modeRef = useRef<HTMLSelectElement>(null);
  const cfgRef = useRef<HTMLTextAreaElement>(null);

  // If URL hash looks like #source-123, use that id
  useEffect(() => {
    const h = window.location.hash;
    const m = /^#source-(\d+)$/.exec(h);
    if (m) {
      setId(Number(m[1]));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (typeof id !== "number" || !Number.isFinite(id)) {
        setSrc(null);
        return;
      }
      setLoading(true);
      const s = await fetchSource(id);
      if (!cancelled) {
        setSrc(s);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const cfgText = useMemo(
    () =>
      src?.adapter_config ? JSON.stringify(src.adapter_config, null, 2) : "",
    [src?.adapter_config]
  );

  return (
    <div className="rounded-xl border p-4">
      <h3 className="mb-3 text-lg font-semibold">Edit Source</h3>

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
            if (typeof id === "number") {
              // refresh by re-setting id
              setId(Number(id));
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

            if (rssRef.current) payload.rss_url = rssRef.current.value || null;
            if (homeRef.current) payload.homepage_url = homeRef.current.value || null;
            if (keyRef.current) payload.scraper_key = keyRef.current.value || null;
            if (modeRef.current) payload.fetch_mode = (modeRef.current.value as SourceRow["fetch_mode"]) ?? null;

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

            await fetch("/api/admin/sources", {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(payload),
            });

            alert("Saved!");
          }}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              <div className="mb-1 text-zinc-600">Homepage URL</div>
              <input
                ref={homeRef}
                defaultValue={src.homepage_url ?? ""}
                className="w-full rounded border px-2 py-1"
                placeholder="https://…"
              />
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

          <div className="flex gap-2">
            <button className="rounded border px-3 py-1.5 text-sm hover:bg-zinc-50">
              Save
            </button>
            <a
              className="rounded border px-3 py-1.5 text-sm hover:bg-zinc-50"
              href={`/api/admin/ingest?sourceId=${src.id}&limit=50&includeHealth=1`}
              target="_blank"
            >
              Test Ingest
            </a>
          </div>
        </form>
      )}

      {!loading && !src && typeof id === "number" && (
        <div className="text-sm text-rose-700">No source with id {id}.</div>
      )}
    </div>
  );
}
