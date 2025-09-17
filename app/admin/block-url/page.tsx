"use client";
import { useEffect, useState } from "react";
import { AdminNav } from "@/components/admin/AdminNav";

type Row = { url: string; reason: string | null; created_at: string; host: string | null };

export default function BlockUrlPage() {
  const [url, setUrl] = useState("");
  const [reason, setReason] = useState("");
  const [deleteExisting, setDel] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh() {
    try {
      const r = await fetch("/api/admin/block-url", { cache: "no-store" });
      const txt = await r.text();
      const j = txt ? JSON.parse(txt) : {};
      if (!r.ok) throw new Error(j?.error || txt || `HTTP ${r.status}`);
      setRows(Array.isArray(j.entries) ? j.entries : []);
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/block-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, reason, deleteExisting }),
      });

      const txt = await r.text();                 // ← defensive: don’t assume JSON
      const j = txt ? JSON.parse(txt) : {};
      if (!r.ok || !j.ok) {
        throw new Error(j?.error || txt || `HTTP ${r.status}`);
      }

      setMsg(`Blocked: ${j.canonical}${deleteExisting ? ` (deleted ${j.deleted})` : ""}`);
      setUrl("");
      setReason("");
      setDel(true);
      await refresh();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-6">
       {/* Admin nav */}
      <AdminNav active="block-url" />
      <h1 className="text-2xl font-semibold">Block URL</h1>
      <form onSubmit={submit} className="space-y-3">
        <input
          className="w-full border rounded p-2"
          placeholder="Paste article URL…"
          value={url}
          onChange={e => setUrl(e.target.value)}
          required
        />
        <input
          className="w-full border rounded p-2"
          placeholder="Optional reason (notes)"
          value={reason}
          onChange={e => setReason(e.target.value)}
        />
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={deleteExisting} onChange={e => setDel(e.target.checked)} />
          <span>Delete existing article row (recommended)</span>
        </label>
        <button className="px-4 py-2 rounded bg-zinc-900 text-white disabled:opacity-50" disabled={busy}>
          {busy ? "Blocking…" : "Block"}
        </button>
        {msg && <p className="text-sm text-zinc-600">{msg}</p>}
      </form>

      <section>
        <h2 className="text-lg font-semibold mb-2">Recent blocks</h2>
        <div className="space-y-2">
          {rows.map(r => (
            <div key={r.url} className="border rounded p-3">
              <div className="font-mono text-sm break-all">{r.url}</div>
              <div className="text-xs text-zinc-600">
                {r.host ?? "—"} · {new Date(r.created_at).toLocaleString()} {r.reason ? `· ${r.reason}` : ""}
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
