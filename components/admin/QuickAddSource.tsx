"use client";

import { useEffect, useMemo, useState } from "react";
import { PendingFieldset } from "./RunIngestControls";

type TestResult = {
  ok: boolean;
  totalFound?: number;
  sampleCount?: number;
  sample?: Array<{ url: string; title?: string }>;
  error?: string;
};

type FetchMode = "auto" | "rss" | "adapter";

export default function QuickAddSource() {
  const [name, setName] = useState<string>("");
  const [homepageUrl, setHomepageUrl] = useState<string>("");
  const [rssUrl, setRssUrl] = useState<string>("");
  const [sitemapUrl, setSitemapUrl] = useState<string>("");
  const [faviconUrl, setFaviconUrl] = useState<string>("");
  const [scrapePath, setScrapePath] = useState<string>("");
  const [scraperKey, setScraperKey] = useState<string>("");
  const [fetchMode, setFetchMode] = useState<FetchMode>("auto");
  const [adapterJson, setAdapterJson] = useState<string>("{}");
  const [testLimit, setTestLimit] = useState<number>(5);
  const [testPages, setTestPages] = useState<number>(2);

  const adapter_config = useMemo<Record<string, unknown> | null>(() => {
    try {
      const obj = JSON.parse(adapterJson || "{}") as Record<string, unknown>;
      return obj;
    } catch {
      return null;
    }
  }, [adapterJson]);

  const [testing, setTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  async function onTestAdapter() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/admin/test-adapter", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scraper_key: (scraperKey || "").trim(),
          pageCount: Number.isFinite(testPages) ? testPages : 2,
          limit: Number.isFinite(testLimit) ? testLimit : 5,
          adapter_config: adapter_config ?? {},
        }),
      });
      const json = (await res.json()) as TestResult;
      setTestResult(json);
    } catch (err) {
      setTestResult({ ok: false, error: (err as Error).message });
    } finally {
      setTesting(false);
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const body = {
      name,
      homepage_url: homepageUrl || "",
      rss_url: rssUrl || "",
      sitemap_url: sitemapUrl || "",
      favicon_url: faviconUrl || "",
      scrape_path: scrapePath || "",
      scraper_key: scraperKey || "",
      fetch_mode: fetchMode,
      adapter_config: adapter_config ?? {},
      allowed: true,
      priority: 0,
    };

    const res = await fetch("/api/admin/sources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      // reset a few fields after creating
      setName("");
      setHomepageUrl("");
      setRssUrl("");
      setSitemapUrl("");
      setFaviconUrl("");
      setScrapePath("");
    } else {
      const j = (await res.json()) as { error?: string };
      alert(`Create failed: ${j.error ?? "unknown_error"}`);
    }
  }

  return (
    <section className="rounded-xl border p-4">
      <h2 className="mb-3 text-lg font-semibold">Quick Add Source</h2>

      <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="grid gap-1">
            <span className="text-sm text-zinc-700">Name</span>
            <input className="rounded border px-3 py-2"
              value={name} onChange={(e) => setName(e.target.value)} required />
          </label>

          <label className="grid gap-1">
            <span className="text-sm text-zinc-700">Homepage URL</span>
            <input className="rounded border px-3 py-2"
              value={homepageUrl} onChange={(e) => setHomepageUrl(e.target.value)} />
          </label>

          <label className="grid gap-1">
            <span className="text-sm text-zinc-700">RSS URL</span>
            <input className="rounded border px-3 py-2"
              value={rssUrl} onChange={(e) => setRssUrl(e.target.value)} />
          </label>

          <label className="grid gap-1">
            <span className="text-sm text-zinc-700">Sitemap URL</span>
            <input className="rounded border px-3 py-2"
              value={sitemapUrl} onChange={(e) => setSitemapUrl(e.target.value)} />
          </label>

          <label className="grid gap-1">
            <span className="text-sm text-zinc-700">Favicon URL</span>
            <input className="rounded border px-3 py-2"
              value={faviconUrl} onChange={(e) => setFaviconUrl(e.target.value)} />
          </label>

          <label className="grid gap-1">
            <span className="text-sm text-zinc-700">
              Optional scrape path (e.g. <code>/articles/fantasy</code>)
            </span>
            <input className="rounded border px-3 py-2"
              value={scrapePath} onChange={(e) => setScrapePath(e.target.value)} />
          </label>
        </div>

        {/* Adapter settings */}
        <div className="sm:col-span-2 mt-2 rounded border p-3">
          <div className="mb-2 font-medium">Adapter (optional)</div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1">
              <span className="text-sm text-zinc-700">scraper_key</span>
              <input className="rounded border px-3 py-2"
                value={scraperKey} onChange={(e) => setScraperKey(e.target.value)} placeholder="fantasylife" />
            </label>

            <label className="grid gap-1">
              <span className="text-sm text-zinc-700">fetch_mode</span>
              <select className="rounded border px-3 py-2"
                value={fetchMode} onChange={(e) => setFetchMode(e.target.value as FetchMode)}>
                <option value="auto">auto</option>
                <option value="rss">rss</option>
                <option value="adapter">adapter</option>
              </select>
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1">
                <span className="text-sm text-zinc-700">test pages</span>
                <input className="rounded border px-3 py-2"
                  type="number" min={1} max={10}
                  value={testPages}
                  onChange={(e) => setTestPages(Number(e.target.value) || 1)} />
              </label>
              <label className="grid gap-1">
                <span className="text-sm text-zinc-700">test limit</span>
                <input className="rounded border px-3 py-2"
                  type="number" min={1} max={50}
                  value={testLimit}
                  onChange={(e) => setTestLimit(Number(e.target.value) || 5)} />
              </label>
            </div>
          </div>

          <label className="mt-3 grid gap-1">
            <span className="text-sm text-zinc-700">adapter_config (JSON)</span>
            <textarea
              className="min-h-[110px] rounded border px-3 py-2 font-mono text-sm"
              value={adapterJson}
              onChange={(e) => setAdapterJson(e.target.value)}
              placeholder='{"pageCount":2}'
            />
          </label>

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={onTestAdapter}
              disabled={testing || !scraperKey || adapter_config === null}
              className="rounded border px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-60"
              title={adapter_config === null ? "Invalid JSON" : "Test adapter"}
            >
              {testing ? "Testing…" : "Test Adapter"}
            </button>
            <div className="text-xs text-zinc-600">
              Runs <code>/api/admin/test-adapter</code> with the values above.
            </div>
          </div>

          {/* Test results */}
          {testResult && (
            <div className="mt-3 rounded border p-3">
              {testResult.ok ? (
                <>
                  <div className="text-sm">
                    Found <b>{testResult.totalFound ?? 0}</b>; showing sample{" "}
                    <b>{testResult.sampleCount ?? 0}</b>
                  </div>
                  <ul className="mt-2 list-disc pl-5 text-sm">
                    {(testResult.sample ?? []).map((s) => (
                      <li key={s.url}>
                        <a className="text-blue-700 underline" href={s.url} target="_blank">
                          {s.title ?? s.url}
                        </a>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <div className="text-sm text-rose-700">
                  Failed: {testResult.error ?? "unknown_error"}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="sm:col-span-2 flex items-center gap-2">
          <button className="rounded border px-3 py-2 hover:bg-zinc-50">Add Source</button>
          <span className="text-xs text-zinc-600">You can test first, then add.</span>
        </div>
      </form>
    </section>
  );
}
