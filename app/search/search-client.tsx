"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

export type SearchResult = {
  id: number;
  title: string;
  url: string;
  canonical_url: string | null;
  domain: string | null;
  published_at: string | null;
  source: string;
  rank: number;
  headline: string;
};

export default function SearchClient() {
  const params = useSearchParams();
  const initialQ = (params.get("q") || "").trim();

  const [q, setQ] = useState<string>(initialQ);
  const [items, setItems] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  const runSearch = useMemo(() => {
    let t: ReturnType<typeof setTimeout>;
    return async (term: string) => {
      clearTimeout(t);
      t = setTimeout(async () => {
        const needle = term.trim();
        if (!needle) { setItems([]); return; }
        setLoading(true);
        try {
          const res = await fetch(`/api/search?q=${encodeURIComponent(needle)}&limit=40`, { cache: "no-store" });
          const json = await res.json();
          setItems((json.items as SearchResult[]) || []);
        } finally {
          setLoading(false);
        }
      }, 200);
    };
  }, []);

  useEffect(() => { if (initialQ) runSearch(initialQ); }, [initialQ, runSearch]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); runSearch(e.target.value); }}
          onKeyDown={(e) => { if (e.key === "Enter") runSearch(q); }}
          placeholder='Search players/topics, e.g. “Bijan, tiers”'
          className="w-full rounded-lg border px-3 py-2"
        />
        <button
          onClick={() => runSearch(q)}
          className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800"
        >
          Search
        </button>
      </div>

      {loading && <div className="text-sm text-zinc-500">Searching…</div>}

      <ul className="space-y-4">
        {items.map((it) => (
          <li key={it.id} className="rounded-lg border p-3">
            <a
              className="text-xs text-zinc-500"
              href={it.canonical_url ?? it.url}
              target="_blank"
              rel="noreferrer"
            >
              {it.source}{it.domain ? ` · ${it.domain}` : ""}
            </a>
            <h3
              className="mt-1 text-base font-medium text-zinc-900"
              dangerouslySetInnerHTML={{ __html: it.headline || it.title }}
            />
          </li>
        ))}
        {!loading && items.length === 0 && initialQ && (
          <li className="text-sm text-zinc-500">No results for “{initialQ}”.</li>
        )}
      </ul>
    </div>
  );
}
