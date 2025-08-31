"use client";

import { useMemo, useState } from "react";

type SourceRow = {
  id: number;
  name: string | null;
  homepage_url: string | null;
  rss_url: string | null;
  sitemap_url: string | null;
  favicon_url: string | null;
  scrape_path: string | null;
  scrape_selector?: string | null;
  scraper_key?: string | null;
  fetch_mode?: "auto" | "rss" | "adapter" | null;
  adapter_config?: Record<string, unknown> | null;
  allowed?: boolean | null;
  priority?: number | null;
};

type ApiListResponse = SourceRow[];

type TestResult = {
  ok: boolean;
  totalFound?: number;
  sampleCount?: number;
  sample?: Array<{ url: string; title?: string }>;
  error?: string;
};

export default function SourcesTable() {
  const [rows, setRows] = useState<ApiListResponse>([]);
  const [loading, setLoading] = useState<boolean>(true);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/sources", { cache: "no-store" });
      const json = (await res.json()) as ApiListResponse;
      setRows(json);
    } finally {
      setLoading(false);
    }
  }

  useMemo(() => {
    // initial fetch
    void load();
  }, []);

  return (
    <div className="overflow-x-auto">
      {loading ? (
        <div className="p-3 text-sm text-zinc-600">Loading…</div>
      ) : (
        <table className="min-w-full text-sm">
          <thead className="bg-zinc-50">
            <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left">
              <th>id</th>
              <th>name</th>
              <th>homepage</th>
              <th>rss</th>
              <th>scraper_key</th>
              <th>fetch_mode</th>
              <th>adapter_config</th>
              <th>test</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Row key={r.id} row={r} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Row({ row }: { row: SourceRow }) {
  const [scraperKey, setScraperKey] = useState<string>(row.scraper_key ?? "");
  const [fetchMode, setFetchMode] = useState<"auto" | "rss" | "adapter">(row.fetch_mode ?? "auto");
  const [json, setJson] = useState<string>(
    JSON.stringify(row.adapter_config ?? {}, null, 2)
  );
  const [pages, setPages] = useState<number>(2);
  const [limit, setLimit] = useState<number>(5);
  const [testing, setTesting] = useState<boolean>(false);
  const [result, setResult] = useState<TestResult | null>(null);

  function parsed(): Record<string, unknown> | null {
    try {
      return JSON.parse(json || "{}") as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  async function onTest() {
    setTesting(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/test-adapter", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scraper_key: (scraperKey || "").trim(),
          pageCount: pages,
          limit,
          adapter_config: parsed() ?? {},
        }),
      });
      const j = (await res.json()) as TestResult;
      setResult(j);
    } catch (err) {
      setResult({ ok: false, error: (err as Error).message });
    } finally {
      setTesting(false);
    }
  }

  return (
    <tr id={`source-${row.id}`} className="border-t align-top">
      <td className="px-3 py-2 font-mono text-xs">{row.id}</td>
      <td className="px-3 py-2">{row.name ?? "—"}</td>
      <td className="px-3 py-2">
        {row.homepage_url ? (
          <a className="text-blue-700 underline" href={row.homepage_url} target="_blank">
            homepage
          </a>
        ) : (
          "—"
        )}
      </td>
      <td className="px-3 py-2">
        {row.rss_url ? (
          <a className="text-blue-700 underline" href={row.rss_url} target="_blank">
            rss
          </a>
        ) : (
          "—"
        )}
      </td>

      <td className="px-3 py-2">
        <input
          className="w-36 rounded border px-2 py-1"
          value={scraperKey}
          onChange={(e) => setScraperKey(e.target.value)}
          placeholder="fantasylife"
        />
      </td>

      <td className="px-3 py-2">
        <select
          className="rounded border px-2 py-1"
          value={fetchMode}
          onChange={(e) => setFetchMode(e.target.value as "auto" | "rss" | "adapter")}
        >
          <option value="auto">auto</option>
          <option value="rss">rss</option>
          <option value="adapter">adapter</option>
        </select>
      </td>

      <td className="px-3 py-2">
        <textarea
          className="h-24 w-[28ch] rounded border px-2 py-1 font-mono text-xs"
          value={json}
          onChange={(e) => setJson(e.target.value)}
        />
        <div className="mt-1 flex gap-2 text-xs text-zinc-600">
          <label className="flex items-center gap-1">
            pages
            <input
              className="w-14 rounded border px-2 py-0.5"
              type="number"
              min={1}
              max={10}
              value={pages}
              onChange={(e) => setPages(Number(e.target.value) || 1)}
            />
          </label>
          <label className="flex items-center gap-1">
            limit
            <input
              className="w-16 rounded border px-2 py-0.5"
              type="number"
              min={1}
              max={50}
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value) || 5)}
            />
          </label>
        </div>
      </td>

      <td className="px-3 py-2">
        <button
          className="rounded border px-2 py-1 text-xs hover:bg-zinc-50 disabled:opacity-60"
          onClick={onTest}
          disabled={testing || !scraperKey || parsed() === null}
          title={parsed() === null ? "Invalid JSON" : "Test adapter"}
        >
          {testing ? "Testing…" : "Test"}
        </button>

        {result && (
          <div className="mt-2 max-w-[36ch] rounded border p-2">
            {result.ok ? (
              <>
                <div className="text-xs">
                  Found <b>{result.totalFound ?? 0}</b>; sample{" "}
                  <b>{result.sampleCount ?? 0}</b>
                </div>
                <ul className="mt-1 list-disc pl-4 text-xs">
                  {(result.sample ?? []).map((s) => (
                    <li key={s.url}>
                      <a className="text-blue-700 underline" href={s.url} target="_blank">
                        {s.title ?? s.url}
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <div className="text-xs text-rose-700">
                Failed: {result.error ?? "unknown_error"}
              </div>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}
