// admin/sourceroweditor.tsx
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
    | "name"
    | "rss_url"
    | "homepage_url"
    | "scraper_key"
    | "fetch_mode"
    | "adapter_config"
  >
>;

type TestAdapterResult = {
  ok: boolean;
  totalFound?: number;
  sampleCount?: number;
  sample?: Array<{ url: string; title?: string }>;
  error?: string;
};

const ADMIN_KEY = (process.env.NEXT_PUBLIC_ADMIN_KEY ?? "").trim();

/* Small helpers (no `any`) */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function coerceNumber(u: unknown, fallback: number): number {
  if (typeof u === "number" && Number.isFinite(u)) return u;
  if (typeof u === "string") {
    const n = Number(u);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

/* ——— JSON parser for adapter_config ——— */
function parseAdapterConfig(
  text: string
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  try {
    const trimmed = text.trim();
    if (!trimmed) return { ok: true, value: {} };
    const obj = JSON.parse(trimmed);
    if (isRecord(obj)) {
      return { ok: true, value: obj };
    }
    return { ok: false, error: "Config must be a JSON object (not array/string)." };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/* ——— Fetch one source (supports several response shapes) ——— */
async function fetchSource(id: number): Promise<SourceRow | null> {
  const res = await fetch(`/api/admin/sources?id=${id}`, { cache: "no-store" });
  if (!res.ok) return null;
  const data = await res.json();

  if (data && typeof data === "object" && "source" in data) {
    return (data as { source?: SourceRow }).source ?? null;
  }
  if (Array.isArray(data)) {
    return (data as SourceRow[]).find((r) => r.id === id) ?? null;
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

  // feedback
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // test adapter (preview)
  const [taLoading, setTaLoading] = useState(false);
  const [taResult, setTaResult] = useState<TestAdapterResult | null>(null);
  const [taMsg, setTaMsg] = useState<string | null>(null);

  // test ingest (writes)
  const [tiLoading, setTiLoading] = useState(false);
  const [tiMsg, setTiMsg] = useState<string | null>(null);

  // open/close tracking for ESC
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

  /* Load helper */
  const loadById = async (theId: number) => {
    setLoading(true);
    try {
      const s = await fetchSource(theId);
      setSrc(s);
      setSaveMsg(null);
      setTaResult(null);
      setTaMsg(null);
      setTiMsg(null);
    } finally {
      setLoading(false);
    }
  };

  /* Close helper */
  const closeEditor = () => {
    setSrc(null);
    setId("");
    setSaveMsg(null);
    setTaResult(null);
    setTaMsg(null);
    setTiMsg(null);
    history.replaceState(null, "", location.pathname + location.search);
  };

  /* Sync with #source-123 and custom “source:open” events */
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
  }, []);

  const cfgText = useMemo(
    () => (src?.adapter_config ? JSON.stringify(src.adapter_config, null, 2) : ""),
    [src?.adapter_config]
  );

  /* Populate inputs when src changes */
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

  /* Save (used by Save + Test Ingest) */
  async function saveCurrent(): Promise<boolean> {
    if (!src) return false;

    const payload: SavePayload = { id: src.id };

    const nm = nameRef.current?.value?.trim() ?? "";
    payload.name = nm.length > 0 ? nm : null;

    payload.rss_url = rssRef.current?.value || null;
    payload.homepage_url = homeRef.current?.value || null;

    const key = keyRef.current?.value?.trim() ?? "";
    payload.scraper_key = key || null;

    const modeVal = (modeRef.current?.value as SourceRow["fetch_mode"]) ?? "auto";
    payload.fetch_mode = modeVal;

    const parsed = parseAdapterConfig(cfgRef.current?.value ?? "");
    if (!parsed.ok) {
      setSaveMsg(`Invalid adapter_config: ${parsed.error}`);
      return false;
    }
    payload.adapter_config = parsed.value;

    setSaving(true);
    setSaveMsg(null);
    try {
      const resp = await fetch("/api/admin/sources", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        let err = "";
        try {
          const j = await resp.json();
          err = (isRecord(j) && typeof j.error === "string") ? j.error : "";
        } catch {
          try {
            err = await resp.text();
          } catch {
            /* noop */
          }
        }
        setSaveMsg(`Save failed: ${err || resp.statusText}`);
        return false;
      }

      setSaveMsg("Saved ✔︎");
      void loadById(src.id); // refresh with any computed/default fields
      return true;
    } catch (e) {
      setSaveMsg(`Save failed: ${(e as Error).message}`);
      return false;
    } finally {
      setSaving(false);
    }
  }

  /* Test Adapter (preview) — no DB writes */
  async function onTestAdapter() {
    if (!src) return;
    setTaResult(null);
    setTiMsg(null);

    // parse config *without* saving
    const parsed = parseAdapterConfig(cfgRef.current?.value ?? "");
    if (!parsed.ok) {
      setTaResult({ ok: false, error: `Invalid adapter_config: ${parsed.error}` });
      return;
    }
    const cfg: Record<string, unknown> = parsed.value;

    const key = (keyRef.current?.value ?? "").trim();
    if (!key) {
      setTaResult({ ok: false, error: "scraper_key is empty." });
      return;
    }

    const pageCount = coerceNumber(cfg.pageCount, 2);
    const limit = coerceNumber(cfg.limit, 20);

    setTaLoading(true);
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (ADMIN_KEY) headers["x-admin-key"] = ADMIN_KEY;

      const res = await fetch("/api/admin/test-adapter", {
        method: "POST",
        headers,
        body: JSON.stringify({
          scraper_key: key,
          pageCount,
          limit,
          adapter_config: cfg,
        }),
      });

      const jUnknown = await res.json().catch<unknown>(() => ({}));
      const j = isRecord(jUnknown) ? (jUnknown as unknown as TestAdapterResult) : { ok: false, error: "invalid JSON" };

      if (!res.ok) {
        setTaResult({ ok: false, error: (isRecord(jUnknown) && typeof jUnknown.error === "string") ? jUnknown.error : res.statusText });
      } else {
        setTaResult(j);
      }
    } catch (e) {
      setTaResult({ ok: false, error: (e as Error).message });
    } finally {
      setTaLoading(false);
    }
  }

  /* Test Ingest — saves first, then POSTs JSON to /api/admin/ingest */
  async function onTestIngest() {
    if (!src) return;
    setTiMsg(null);

    const ok = await saveCurrent();
    if (!ok) return;

    setTiLoading(true);
    try {
      const qs = new URLSearchParams({ sourceId: String(src.id) });

      const headers: Record<string, string> = { "content-type": "application/json" };
      if (ADMIN_KEY) headers["x-admin-key"] = ADMIN_KEY;

      const body = JSON.stringify({ limit: 50, includeHealth: true });

      const res = await fetch(`/api/admin/ingest?${qs.toString()}`, {
        method: "POST",
        headers,
        body,
      });

      let text = "";
      let json: unknown = undefined;
      try {
        json = await res.json();
      } catch {
        try {
          text = await res.text();
        } catch {
          /* ignore */
        }
      }

      if (res.ok) {
        const inserted = isRecord(json) && typeof json.inserted === "number" ? json.inserted : 0;
        const updated = isRecord(json) && typeof json.updated === "number" ? json.updated : 0;
        const skipped = isRecord(json) && typeof json.skipped === "number" ? json.skipped : 0;
        setTiMsg(`OK — inserted=${inserted}, updated=${updated}, skipped=${skipped}`);
      } else {
        const err =
          (isRecord(json) && typeof json.error === "string" && json.error) ||
          (isRecord(json) && typeof json.message === "string" && json.message) ||
          (text || res.statusText);
        setTiMsg(`Failed (${res.status}) — ${err}`);
      }
    } catch (e) {
      setTiMsg(`Failed — ${(e as Error).message}`);
    } finally {
      setTiLoading(false);
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
            await saveCurrent();
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
                placeholder="fftoday"
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

          {/* Save + tests */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="rounded border px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-60"
              disabled={saving}
            >
              {saving ? "Saving…" : "Save"}
            </button>

            <button
              type="button"
              onClick={onTestAdapter}
              className="rounded border px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-60"
              disabled={taLoading}
              title="Preview adapter output without saving"
            >
              {taLoading ? "Testing…" : "Test Adapter (preview)"}
            </button>

            <button
              type="button"
              onClick={onTestIngest}
              className="rounded border px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-60"
              disabled={tiLoading}
              title="Save then run a one-off ingest for this source"
            >
              {tiLoading ? "Ingesting…" : "Test Ingest"}
            </button>

            {saveMsg ? (
              <span className="text-xs text-zinc-600">{saveMsg}</span>
            ) : null}
            {taMsg ? (
              <span className="text-xs text-zinc-600 whitespace-pre-line">{taMsg}</span>
            ) : null}
            {tiMsg ? (
              <span className="text-xs text-zinc-600">{tiMsg}</span>
            ) : null}
          </div>

          {/* Adapter preview results */}
          {taResult ? (
            <div className="mt-3 rounded border p-2 text-sm">
              {taResult.ok ? (
                <>
                  <div>
                    Found <b>{taResult.totalFound ?? 0}</b> • showing{" "}
                    <b>{taResult.sampleCount ?? 0}</b>
                  </div>
                  <ul className="mt-1 list-disc pl-5">
                    {(taResult.sample ?? []).map((s) => (
                      <li key={s.url}>
                        <a
                          className="text-blue-700 underline"
                          href={s.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {s.title || s.url}
                        </a>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <div className="text-rose-700">
                  Failed: {taResult.error ?? "unknown_error"}
                </div>
              )}
            </div>
          ) : null}
        </form>
      )}

      {!loading && !src && typeof id === "number" && id > 0 && (
        <div className="text-sm text-rose-700">No source with id {id}.</div>
      )}
    </section>
  );
}
