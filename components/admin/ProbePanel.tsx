// components/admin/ProbePanel.tsx
"use client";

import { useState, useMemo } from "react";
import type {
  ProbeResult,
  ProbeMethod,
  FeedCandidate,
  ScrapeCandidate,
} from "@/lib/sourceProbe/types";

export default function ProbePanel() {
  const [url, setUrl] = useState("");
  const [data, setData] = useState<ProbeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function probe() {
    setLoading(true);
    setErr(null);
    setData(null);
    try {
      const r = await fetch("/api/admin/source-probe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData((await r.json()) as ProbeResult);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  // Derive best options for display & enabling buttons
  const derived = useMemo(() => {
    if (!data) {
      return {
        rec: null as ProbeMethod | null,
        bestFeed: null as FeedCandidate | null,
        bestScrape: null as ScrapeCandidate | null,
        bestAdapter: null as { key: string; itemCount: number } | null,
        canUseRss: false,
        canUseScrape: false,
        canUseAdapter: false,
      };
    }
    const rec = data.recommended.method;

    const bestFeed =
      data.feeds.filter((f) => f.ok).sort((a, b) => b.itemCount - a.itemCount)[0] ?? null;
    const bestScrape =
      data.scrapes.filter((s) => s.ok).sort((a, b) => b.linkCount - a.linkCount)[0] ?? null;
    const ba = data.adapters.filter((a) => a.ok).sort((a, b) => b.itemCount - a.itemCount)[0];
    const bestAdapter = ba ? { key: ba.key, itemCount: ba.itemCount } : null;

    return {
      rec,
      bestFeed,
      bestScrape,
      bestAdapter,
      canUseRss: !!bestFeed,
      canUseScrape: !!bestScrape,
      canUseAdapter: !!bestAdapter,
    };
  }, [data]);

  function btnClass(kind: ProbeMethod, enabled: boolean) {
    const isRec = data?.recommended.method === kind;
    if (!enabled) return "rounded border px-3 py-2 text-sm opacity-40 cursor-not-allowed";
    return isRec
      ? "rounded px-3 py-2 text-sm bg-black text-white hover:bg-black/90"
      : "rounded border px-3 py-2 text-sm hover:bg-zinc-50";
  }

  async function commit(method: ProbeMethod) {
    if (!data) return;

    const commitUrl = data.recommended.suggestedUrl ?? url;
    const nameHint = (() => {
      try {
        return new URL(commitUrl).host;
      } catch {
        return null;
      }
    })();

    const body: {
      url: string;
      method: ProbeMethod;
      feedUrl?: string | null;
      selector?: string | null;
      nameHint?: string | null;
      adapterKey?: string | null;
    } = {
      url: commitUrl,
      method,
      feedUrl: null,
      selector: null,
      nameHint,
      adapterKey: null,
    };

    if (method === "rss") {
      body.feedUrl = data.recommended.feedUrl ?? derived.bestFeed?.feedUrl ?? null;
    }
    if (method === "scrape") {
      body.selector = data.recommended.selector ?? derived.bestScrape?.selectorTried ?? null;
    }
    if (method === "adapter") {
      body.adapterKey = derived.bestAdapter?.key ?? null;
    }

      const r = await fetch("/api/admin/source-probe/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}) as { error?: string })) as { error?: string };
        alert(`Commit failed: ${j.error ?? r.statusText}`);
        return;
      }
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; sourceId?: number };
      alert(j?.sourceId ? `Saved! Source #${j.sourceId}` : "Saved!");
  }

  return (
    <section className="rounded-xl border p-4">
      <h2 className="mb-3 text-lg font-semibold">Probe a new source</h2>
      <div className="flex gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.nfl.com/news/series/fantasy-football-news"
          className="flex-1 rounded border p-2"
        />
        <button onClick={probe} className="rounded border px-3 py-2 hover:bg-zinc-50">
          {loading ? "Probing…" : "Probe"}
        </button>
      </div>

      {err ? <div className="mt-3 text-sm text-rose-700">Error: {err}</div> : null}

      {data ? (
        <div className="mt-4 space-y-3 text-sm">
          <div>
            <b>Recommendation:</b> {data.recommended.method} — {data.recommended.rationale}
            {data.recommended.suggestedUrl ? (
              <div className="mt-1 text-xs text-zinc-600">
                Suggested link to save:{" "}
                <code className="font-mono break-all">{data.recommended.suggestedUrl}</code>
              </div>
            ) : null}
            {data.recommended.selector ? (
              <div className="mt-1 text-xs text-zinc-600">
                Selector: <code className="font-mono">{data.recommended.selector}</code>
              </div>
            ) : null}
            {data.recommended.feedUrl ? (
              <div className="mt-1 text-xs text-zinc-600">
                Feed: <span className="break-all">{data.recommended.feedUrl}</span>
              </div>
            ) : null}
          </div>

          <div className="rounded border p-2">
            <b>Feeds</b>
            <ul className="list-disc pl-5">
              {data.feeds.map((f) => (
                <li key={f.feedUrl}>
                  {f.ok ? "✅" : "❌"} {f.feedUrl}{" "}
                  {f.ok ? `(${f.itemCount})` : f.error ? `— ${f.error}` : ""}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded border p-2">
            <b>Scrape selectors</b>
            <ul className="list-disc pl-5">
              {data.scrapes.map((s) => (
                <li key={s.selectorTried}>
                  {s.ok ? "✅" : "❌"} {s.selectorTried}{" "}
                  {s.ok ? `(${s.linkCount})` : s.error ? `— ${s.error}` : ""}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded border p-2">
            <b>Adapters</b>
            <ul className="list-disc pl-5">
              {data.adapters.map((a) => (
                <li key={a.key}>
                  {a.ok ? "✅" : "❌"} {a.label ?? a.key}{" "}
                  {a.ok ? `(${a.itemCount})` : a.error ? `— ${a.error}` : ""}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded border p-2">
            <b>Preview ({data.preview.length})</b>
            <ul className="list-disc pl-5">
              {data.preview.slice(0, 12).map((a) => (
                <li key={a.url}>{a.title}</li>
              ))}
            </ul>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => derived.canUseRss && commit("rss")}
              disabled={!derived.canUseRss}
              className={btnClass("rss", derived.canUseRss)}
              title={derived.canUseRss ? "Create source using RSS" : "No working feed detected"}
            >
              Use RSS{derived.bestFeed ? ` (${derived.bestFeed.itemCount})` : ""}
            </button>

            <button
              onClick={() => derived.canUseScrape && commit("scrape")}
              disabled={!derived.canUseScrape}
              className={btnClass("scrape", derived.canUseScrape)}
              title={
                derived.canUseScrape
                  ? "Create source using the selected CSS selector"
                  : "No viable selector found"
              }
            >
              Use Scrape{derived.bestScrape ? ` (${derived.bestScrape.linkCount})` : ""}
            </button>

            <button
              onClick={() => derived.canUseAdapter && commit("adapter")}
              disabled={!derived.canUseAdapter}
              className={btnClass("adapter", derived.canUseAdapter)}
              title={derived.canUseAdapter ? "Create source using an adapter" : "No adapter matched"}
            >
              Use Adapter{derived.bestAdapter ? ` (${derived.bestAdapter.itemCount})` : ""}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
