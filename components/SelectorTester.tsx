"use client";

import { useMemo, useState } from "react";

type Props = {
  sourceId: number;
  defaultUrl: string | null;
  defaultSelector: string | null;
};

type Hit = { href: string; text: string };

type TestScrapeOk = {
  ok: true;
  task: "testScrape";
  source?: {
    id: number;
    name: string | null;
    defaultUrl?: string | null;
    defaultSelector?: string | null;
  };
  url: string;        // URL used by the server
  selector: string;   // selector used by the server
  limit: number;
  hits: Hit[];
};

type TestScrapeErr = {
  ok: false;
  error: string;
  status?: number;
};

type TestScrapeResponse = TestScrapeOk | TestScrapeErr;

const DEFAULT_NFL_SELECTOR = 'a[href*="/nfl/"]';
const FANTASYLIFE_ARTICLES = 'a[href^="/articles/"]';
const HEADLINE_ANCHORS =
  'h2 a[href^="/articles/"], h3 a[href^="/articles/"], article a[href^="/articles/"]';

export default function SelectorTester({ sourceId, defaultUrl, defaultSelector }: Props) {
  // Local form state
  const [url, setUrl] = useState<string>(defaultUrl ?? "");
  const [selector, setSelector] = useState<string>(defaultSelector ?? DEFAULT_NFL_SELECTOR);
  const [limit, setLimit] = useState<number>(20);
  const [log, setLog] = useState<boolean>(false);

  // UX state
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [hits, setHits] = useState<Hit[]>([]);
  const [usedUrl, setUsedUrl] = useState<string>("");
  const [usedSelector, setUsedSelector] = useState<string>("");
  const [serverSourceName, setServerSourceName] = useState<string>("");

  // Build the exact GET we’ll call (for debugging / copy-paste)
  const previewUrl = useMemo(() => {
    const params = new URLSearchParams({
      task: "testScrape",
      sourceId: String(sourceId),
      limit: String(limit),
    });
    if (url.trim()) params.set("url", url.trim());
    if (selector.trim()) params.set("selector", selector.trim());
    if (log) params.set("log", "1");
    return `/api/admin?${params.toString()}`;
  }, [sourceId, limit, url, selector, log]);

  const test = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    setHits([]);
    setUsedUrl("");
    setUsedSelector("");
    setServerSourceName("");

    try {
      const u = new URL(previewUrl, window.location.origin);
      const res = await fetch(u.toString(), { cache: "no-store" });

      let data: TestScrapeResponse;
      try {
        data = (await res.json()) as TestScrapeResponse;
      } catch {
        setError("Response was not valid JSON.");
        return;
      }

      if (!data.ok) {
        setError(data.error || `Request failed${data.status ? ` (HTTP ${data.status})` : ""}.`);
        return;
      }

      setHits(Array.isArray(data.hits) ? data.hits : []);
      setUsedUrl(data.url);
      setUsedSelector(data.selector);
      setServerSourceName(data.source?.name ?? "");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Request failed";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const applyPreset = (preset: "nfl" | "fantasylife" | "headlines") => {
    switch (preset) {
      case "nfl":
        setSelector(DEFAULT_NFL_SELECTOR);
        break;
      case "fantasylife":
        setSelector(FANTASYLIFE_ARTICLES);
        break;
      case "headlines":
        setSelector(HEADLINE_ANCHORS);
        break;
    }
  };

  const useDefaults = () => {
    setUrl(defaultUrl ?? "");
    setSelector(defaultSelector ?? DEFAULT_NFL_SELECTOR);
  };

  const clearOverrides = () => {
    // Let the server pick the source defaults entirely
    setUrl("");
    setSelector("");
  };

  return (
    <div className="mt-3 rounded-lg border border-emerald-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold text-emerald-900">Selector Tester</div>
        <a
          href={previewUrl}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-emerald-700 underline"
          title="Open the exact GET request in a new tab"
        >
          Open request
        </a>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs text-zinc-600">
          URL (leave blank to use source homepage/scrape_path)
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
            onChange={(e) => setLimit(Number(e.target.value || 20))}
            className="mt-1 w-full rounded border border-zinc-300 px-2 py-1"
          />
        </label>

        <label className="col-span-2 block text-xs text-zinc-600">
          CSS selector (leave blank to use source default)
          <input
            value={selector}
            onChange={(e) => setSelector(e.target.value)}
            className="mt-1 w-full rounded border border-zinc-300 px-2 py-1 font-mono"
            placeholder={DEFAULT_NFL_SELECTOR}
          />
        </label>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => applyPreset("nfl")}
          className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50"
          title={DEFAULT_NFL_SELECTOR}
        >
          NFL path preset
        </button>
        <button
          type="button"
          onClick={() => applyPreset("fantasylife")}
          className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50"
          title={FANTASYLIFE_ARTICLES}
        >
          FantasyLife articles preset
        </button>
        <button
          type="button"
          onClick={() => applyPreset("headlines")}
          className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50"
          title={HEADLINE_ANCHORS}
        >
          Headline anchors preset
        </button>

        <span className="mx-2 h-4 w-px bg-zinc-300" />

        <button
          type="button"
          onClick={useDefaults}
          className="rounded border border-emerald-600 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50"
        >
          Use source defaults
        </button>
        <button
          type="button"
          onClick={clearOverrides}
          className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
        >
          Clear overrides
        </button>

        <label className="ml-auto inline-flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={log}
            onChange={(e) => setLog(e.target.checked)}
            className="h-4 w-4"
          />
          Log to ingest_logs
        </label>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={test}
          disabled={loading}
          className="rounded bg-emerald-600 px-3 py-1.5 text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {loading ? "Testing…" : "Test"}
        </button>
        {error ? <span className="text-xs text-red-600">{error}</span> : null}
      </div>

      {(usedUrl || usedSelector || serverSourceName) && (
        <div className="mt-3 rounded border border-zinc-200 bg-zinc-50 p-2 text-xs text-zinc-700">
          <div className="mb-1 font-medium text-zinc-800">Server used</div>
          {serverSourceName ? <div>Source: <span className="font-medium">{serverSourceName}</span></div> : null}
          {usedUrl ? (
            <div className="truncate">
              URL:{" "}
              <a href={usedUrl} className="text-emerald-700 underline" target="_blank" rel="noreferrer">
                {usedUrl}
              </a>
            </div>
          ) : null}
          {usedSelector ? <div>Selector: <code className="rounded bg-white px-1">{usedSelector}</code></div> : null}
        </div>
      )}

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

      {hits.length === 0 && !loading && !error && (
        <div className="mt-3 text-xs text-zinc-600">No matches yet. Try a different selector or clear overrides to use the source defaults.</div>
      )}
    </div>
  );
}
