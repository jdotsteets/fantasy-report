// components/SelectorTester.tsx
"use client";

import { useState } from "react";

type Props = {
  sourceId: number;
  defaultUrl: string | null;
  defaultSelector: string | null;
};

export default function SelectorTester({ sourceId, defaultUrl, defaultSelector }: Props) {
  const [url, setUrl] = useState<string>(defaultUrl ?? "");
  const [selector, setSelector] = useState<string>(defaultSelector ?? 'a[href*="/nfl/"]');
  const [limit, setLimit] = useState<number>(20);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hits, setHits] = useState<Array<{ href: string; text: string }>>([]);

  const test = async () => {
    setLoading(true);
    setError(null);
    setHits([]);
    try {
      const u = new URL(`/api/admin?task=testScrape&sourceId=${sourceId}&limit=${limit}&url=${encodeURIComponent(url)}&selector=${encodeURIComponent(selector)}`, window.location.origin);
      const res = await fetch(u.toString(), { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error || "Failed");
      } else {
        setHits(json.hits || []);
      }
    } catch (e: any) {
      setError(e?.message || "Failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-3 rounded-lg border border-emerald-200 bg-white p-3">
      <div className="mb-2 text-xs font-semibold text-emerald-900">Selector Tester</div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs text-zinc-600">
          URL
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="mt-1 w-full rounded border border-zinc-300 px-2 py-1"
            placeholder="https://site.com/nfl/"
          />
        </label>
        <label className="block text-xs text-zinc-600">
          Limit
          <input
            type="number"
            min={1}
            max={100}
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="mt-1 w-full rounded border border-zinc-300 px-2 py-1"
          />
        </label>
        <label className="col-span-2 block text-xs text-zinc-600">
          CSS selector
          <input
            value={selector}
            onChange={(e) => setSelector(e.target.value)}
            className="mt-1 w-full rounded border border-zinc-300 px-2 py-1 font-mono"
            placeholder={`a[href*="/nfl/"]`}
          />
        </label>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={test}
          disabled={loading || !url || !selector}
          className="rounded bg-emerald-600 px-3 py-1.5 text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {loading ? "Testing…" : "Test"}
        </button>
        {error ? <span className="text-xs text-red-600">{error}</span> : null}
      </div>

      {hits.length > 0 && (
        <div className="mt-3 rounded border border-zinc-200 bg-zinc-50 p-2">
          <div className="mb-1 text-xs text-zinc-600">Matches ({hits.length})</div>
          <ul className="max-h-60 list-disc space-y-1 overflow-auto pl-5">
            {hits.map((h, i) => (
              <li key={i} className="text-xs">
                <a className="text-emerald-700 underline" href={h.href} target="_blank" rel="noreferrer">
                  {h.text || h.href}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
