// components/admin/ArticleProbePanel.tsx
"use client";

import { useEffect, useState } from "react";
import { STATIC_TYPES, staticTypeLabel, type StaticType } from "@/lib/staticTypes";

/* ───────────── Types ───────────── */

type ProbeSource = { id: number; name: string | null };

type ExistingArticle = {
  id: number;
  source_id: number | null;
  url: string;
  canonical_url: string | null;
  title: string | null;
  author: string | null;
  published_at: string | null; // ISO
  domain: string | null;
  is_static: boolean | null;
  static_type: StaticType | null;
};

type ProbeArticle = {
  url: string;
  canonical_url: string | null;
  title: string | null;
  author: string | null;
  published_at: string | null; // ISO
  source: ProbeSource | null;
  domain: string | null;
  existing: ExistingArticle | null;
};

type CommitResp =
  | { ok: true; id: number; action: "inserted" | "updated" }
  | { ok: false; error: string };

/* ───────────── Helpers ───────────── */

const toLocalDT = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
};

const fromLocalDT = (local: string) => {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/* ───────────── Component ───────────── */

export default function ArticleProbePanel() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // last probe payload
  const [probe, setProbe] = useState<ProbeArticle | null>(null);

  // editor state
  const [existingId, setExistingId] = useState<number | null>(null);
  const [sourceId, setSourceId] = useState<number | "">("");
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [publishedAt, setPublishedAt] = useState(""); // datetime-local
  const [canonicalUrl, setCanonicalUrl] = useState("");
  const [isStatic, setIsStatic] = useState(true);
  const [staticType, setStaticType] = useState<StaticType | "">("");

  function hydrateEditor(p: ProbeArticle) {
    // if existing, prefer DB values; else use probed values
    if (p.existing) {
      const e = p.existing;
      setExistingId(e.id);
      setSourceId(e.source_id ?? "");
      setTitle(e.title ?? "");
      setAuthor(e.author ?? "");
      setPublishedAt(e.published_at ? toLocalDT(e.published_at) : "");
      setCanonicalUrl(e.canonical_url ?? "");
      setIsStatic(e.is_static ?? true);
      setStaticType(e.static_type ?? "");
    } else {
      setExistingId(null);
      setSourceId(p.source?.id ?? "");
      setTitle(p.title ?? "");
      setAuthor(p.author ?? "");
      setPublishedAt(p.published_at ? toLocalDT(p.published_at) : "");
      setCanonicalUrl(p.canonical_url ?? "");
      setIsStatic(true);
      setStaticType("");
    }
  }

  async function doProbe() {
    setLoading(true);
    setErr(null);
    setProbe(null);
    try {
      const r = await fetch("/api/admin/article-probe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as ProbeArticle;
      setProbe(j);
      hydrateEditor(j);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    if (!probe) return;
    if (isStatic && !staticType) {
      alert("Choose a static_type before saving.");
      return;
    }

    const payload = {
      id: existingId, // null = insert
      url: probe.url,
      canonical_url: canonicalUrl || null,
      title: title || null,
      author: author || null,
      published_at: fromLocalDT(publishedAt),
      source_id: typeof sourceId === "number" ? sourceId : Number(sourceId) || null,
      is_static: isStatic,
      static_type: isStatic ? (staticType || null) : null,
      domain: probe.domain ?? null,
      // Also send probed canonical so server can double-check duplicates
      probed_canonical: probe.canonical_url ?? null,
    };

    const r = await fetch("/api/admin/article-probe/commit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    const j = (await r.json().catch(() => null)) as CommitResp | null;
    if (!r.ok || !j || j.ok === false) {
      alert(`Save failed: ${(j && "error" in j && j.error) || r.statusText}`);
      return;
    }

    alert(`${j.action === "updated" ? "Updated" : "Inserted"} article #${j.id}`);
    setExistingId(j.id);
  }

  const modeLabel =
    existingId != null ? `Editing existing #${existingId}` : "Creating new article";

  return (
    <section className="rounded-xl border p-4">
      <h2 className="mb-3 text-lg font-semibold">Add / Edit a single article</h2>
      <div className="flex gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/path/to/article"
          className="flex-1 rounded border p-2"
        />
        <button onClick={doProbe} className="rounded border px-3 py-2 hover:bg-zinc-50">
          {loading ? "Probing…" : "Probe"}
        </button>
      </div>

      {err ? <div className="mt-3 text-sm text-rose-700">Error: {err}</div> : null}

      {probe ? (
        <div className="mt-4 space-y-3">
          <div className="rounded border p-3 text-sm text-zinc-700">
            <div className="mb-1">
              <b>{modeLabel}</b>
            </div>
            <div className="text-zinc-600">
              {probe.source ? (
                <>
                  Matched source: <b>#{probe.source.id}</b>{" "}
                  <span>{probe.source.name ?? "(unnamed)"}</span>
                </>
              ) : (
                "No source matched."
              )}
            </div>
            <div className="mt-1 text-xs text-zinc-600 break-all">
              Probed canonical: <code className="font-mono">{probe.canonical_url ?? "—"}</code>
            </div>
          </div>

          {/* Editor */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <div className="mb-1 text-xs text-zinc-600">source_id</div>
              <input
                className="w-full rounded border p-2"
                type="number"
                value={sourceId === "" ? "" : String(sourceId)}
                onChange={(e) =>
                  setSourceId(e.target.value === "" ? "" : Number(e.target.value))
                }
                placeholder="(optional)"
              />
            </label>

            <label className="text-sm">
              <div className="mb-1 text-xs text-zinc-600">canonical_url</div>
              <input
                className="w-full rounded border p-2"
                value={canonicalUrl}
                onChange={(e) => setCanonicalUrl(e.target.value)}
                placeholder="(optional)"
              />
            </label>

            <label className="sm:col-span-2 text-sm">
              <div className="mb-1 text-xs text-zinc-600">title</div>
              <input
                className="w-full rounded border p-2"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>

            <label className="text-sm">
              <div className="mb-1 text-xs text-zinc-600">author</div>
              <input
                className="w-full rounded border p-2"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="(optional)"
              />
            </label>

            <label className="text-sm">
              <div className="mb-1 text-xs text-zinc-600">published_at</div>
              <input
                type="datetime-local"
                className="w-full rounded border p-2"
                value={publishedAt}
                onChange={(e) => setPublishedAt(e.target.value)}
              />
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isStatic}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setIsStatic(checked);
                  if (!checked) setStaticType("");
                }}
              />
              Mark as static
            </label>

            <label className="text-sm">
              <div className="mb-1 text-xs text-zinc-600">static_type</div>
              <select
                className="w-full rounded border p-2"
                disabled={!isStatic}
                value={staticType ?? ""}
                onChange={(e) => setStaticType((e.target.value as StaticType) || "")}
              >
                <option value="">— choose —</option>
                {STATIC_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {staticTypeLabel(t)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex gap-2">
            <button
              onClick={save}
              className="rounded px-3 py-2 text-sm bg-black text-white hover:bg-black/90"
            >
              Save article
            </button>
            <span className="self-center text-xs text-zinc-500 break-all">
              URL: <code className="font-mono">{probe.url}</code>
            </span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
