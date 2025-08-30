// components/admin/QuickAddSource.tsx
"use client";

import { useState } from "react";

const CATEGORY_OPTIONS = [
  { value: "", label: "(none)" },
  { value: "Fantasy News", label: "Fantasy News" },
  { value: "Rankings", label: "Rankings" },
  { value: "Start/Sit", label: "Start/Sit" },
  { value: "Injury", label: "Injury" },
  { value: "DFS", label: "DFS" },
  { value: "Dynasty", label: "Dynasty" },
  { value: "Betting/DFS", label: "Betting/DFS" },
  { value: "Podcast", label: "Podcast" },
  { value: "Team Site", label: "Team Site" },
  { value: "Other", label: "Other" },
];

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
      // NEW
      scrape_path: String(fd.get("scrape_path") || "").trim(),
      scrape_selector: String(fd.get("scrape_selector") || "").trim(),
      favicon_url: String(fd.get("favicon_url") || "").trim(),
      sitemap_url: String(fd.get("sitemap_url") || "").trim(),
      category: String(fd.get("category") || ""),
      priority: Number(fd.get("priority") || 0),
      allowed: fd.get("allowed") === "on",
      // not validated server-side today, harmless to send
      sport: "nfl",
    };

    if (!payload.name || (!payload.homepage_url && !payload.rss_url)) {
      setErr("Name and either Homepage URL or RSS URL are required.");
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
        {/* Required core fields */}
        <label className="text-sm">
          Name
          <input
            name="name"
            className="mt-1 w-full rounded border px-2 py-1"
            required
          />
        </label>
        <label className="text-sm">
          Category (optional)
          <select
            name="category"
            className="mt-1 w-full rounded border px-2 py-1"
            defaultValue=""
          >
            {CATEGORY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          Homepage URL
          <input
            name="homepage_url"
            className="mt-1 w-full rounded border px-2 py-1"
            placeholder="https://site.com/nfl/"
          />
        </label>
        <label className="text-sm">
          RSS URL
          <input
            name="rss_url"
            className="mt-1 w-full rounded border px-2 py-1"
            placeholder="https://site.com/feed.xml"
          />
        </label>

        {/* NEW: scrape_path + selector */}
        <label className="text-sm">
          Scrape path (optional)
          <input
            name="scrape_path"
            className="mt-1 w-full rounded border px-2 py-1"
            placeholder="/articles/fantasy"
          />
          <span className="block pt-1 text-xs text-gray-500">
            If set, this path is resolved against Homepage URL when scraping.
          </span>
        </label>
        <label className="text-sm sm:col-span-2">
          CSS selector (fallback when RSS is empty/broken)
          <input
            name="scrape_selector"
            className="mt-1 w-full rounded border px-2 py-1 font-mono"
            placeholder={`a[href*="/nfl/"]`}
          />
        </label>

        {/* NEW: favicon + sitemap */}
        <label className="text-sm">
          Favicon URL (optional)
          <input
            name="favicon_url"
            className="mt-1 w-full rounded border px-2 py-1"
            placeholder="https://site.com/favicon.ico"
          />
        </label>
        <label className="text-sm">
          Sitemap URL (optional)
          <input
            name="sitemap_url"
            className="mt-1 w-full rounded border px-2 py-1"
            placeholder="https://site.com/sitemap.xml"
          />
        </label>

        {/* NEW: allowed + priority */}
        <label className="text-sm flex items-center gap-2">
          <input
            name="allowed"
            type="checkbox"
            defaultChecked
            className="h-4 w-4"
          />
          Allowed
        </label>
        <label className="text-sm">
          Priority
          <input
            name="priority"
            type="number"
            inputMode="numeric"
            min={0}
            className="mt-1 w-full rounded border px-2 py-1"
            defaultValue={0}
          />
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
