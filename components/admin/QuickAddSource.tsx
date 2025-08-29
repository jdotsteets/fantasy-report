// components/admin/QuickAddSource.tsx
"use client";

import { useState } from "react";

export default function QuickAddSource() {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setErr(null);

    const fd = new FormData(e.currentTarget);
    const payload = {
      name: String(fd.get("name") || "").trim(),
      homepage_url: String(fd.get("homepage_url") || "").trim(),
      rss_url: String(fd.get("rss_url") || "").trim(),
      scrape_selector: String(fd.get("scrape_selector") || "").trim(),
      allowed: true,
      category: "analysis",
      sport: "nfl",
    };

    if (!payload.name || (!payload.homepage_url && !payload.rss_url)) {
      setErr("Name and (homepage or RSS) are required.");
      setSaving(false);
      return;
    }

    const res = await fetch("/api/admin/sources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j?.error || `HTTP ${res.status}`);
      setSaving(false);
      return;
    }

    const j = await res.json();
    const id = j?.id;
    window.location.href = `/admin/sources#source-${id ?? ""}`;
  }

  return (
    <form onSubmit={onSubmit} className="rounded-xl border p-4">
      <h2 className="mb-3 text-lg font-semibold">Add New Source</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-sm">
          Name
          <input name="name" className="mt-1 w-full rounded border px-2 py-1" required />
        </label>
        <label className="text-sm">
          Homepage URL
          <input name="homepage_url" className="mt-1 w-full rounded border px-2 py-1" placeholder="https://site.com/nfl/" />
        </label>
        <label className="text-sm">
          RSS URL
          <input name="rss_url" className="mt-1 w-full rounded border px-2 py-1" placeholder="https://site.com/feed.xml" />
        </label>
        <label className="text-sm sm:col-span-2">
          CSS selector (fallback when RSS is empty/broken)
          <input name="scrape_selector" className="mt-1 w-full rounded border px-2 py-1 font-mono" placeholder={`a[href*="/nfl/"]`} />
        </label>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="submit"
          disabled={saving}
          className="h-9 rounded-md bg-emerald-600 px-3 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Create"}
        </button>
        {err ? <span className="text-sm text-red-600">{err}</span> : null}
      </div>
    </form>
  );
}
