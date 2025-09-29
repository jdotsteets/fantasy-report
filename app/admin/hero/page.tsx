//app/admin/hero/page.tsx

"use client";

import { useState } from "react";
import { AdminNav } from "@/components/admin/AdminNav";

export default function AdminHeroPage() {
  const [url, setUrl] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const [msg, setMsg] = useState<string>("");

  async function setManual() {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/hero/set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const j: { ok?: boolean; error?: string } = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error(j.error ?? "Failed");
      setMsg("Hero set.");
      setUrl("");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function forceAuto() {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/hero/auto", { method: "POST" });
      const j: { ok?: boolean; error?: string } = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error(j.error ?? "Failed");
      setMsg("Auto hero will be used on next load.");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="p-6 space-y-6">
        <AdminNav active="hero" />
      <h1 className="text-2xl font-semibold">Hero Controls</h1>

      <section className="space-y-3">
        <label className="block text-sm font-medium">Paste article URL</label>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="w-full max-w-xl rounded-xl border px-3 py-2"
          placeholder="https://example.com/article"
        />
        <div className="flex items-center gap-2">
          <button
            className="px-3 py-1 rounded-xl bg-black text-white disabled:opacity-50"
            onClick={setManual}
            disabled={busy || !url}
            title="Use this URL as the hero now"
          >
            Use as Hero
          </button>
          <button
            className="px-3 py-1 rounded-xl border disabled:opacity-50"
            onClick={forceAuto}
            disabled={busy}
            title="Clear manual and use Auto (Breaking) immediately"
          >
            New Hero (Auto · Breaking)
          </button>
        </div>
        {msg ? <p className="text-sm text-gray-700">{msg}</p> : null}
      </section>

      <p className="text-xs text-gray-500">
        Manual heroes stick for ~6 hours. Auto mode favors fresh Breaking/News/Injury headlines and rotates ~hourly.
      </p>
    </main>
  );
}
