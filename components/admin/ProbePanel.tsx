// components/admin/ProbePanel.tsx
"use client";

import { useState, useMemo, useEffect } from "react";
import type {
  ProbeResult,
  ProbeMethod,
  FeedCandidate,
  ScrapeCandidate,
  CommitPayload,
} from "@/lib/sources/types";

type Progress = { discovered: number; upserts: number; errors: number; done: boolean };
type TailLine = { t: string; msg: string };

export default function ProbePanel() {
  const [url, setUrl] = useState("");
  const [data, setData] = useState<ProbeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // create vs update + editable fields
  const [mode, setMode] = useState<"create" | "update">("create");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [sport, setSport] = useState("");
  const [allowed, setAllowed] = useState(true);
  const [paywall, setPaywall] = useState<boolean | null>(null);
  const [priority, setPriority] = useState<number | "">("");

  // ✨ ingest tracking UI state
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress>({
    discovered: 0,
    upserts: 0,
    errors: 0,
    done: false,
  });
  const [tail, setTail] = useState<TailLine[]>([]);

  useEffect(() => {
    if (data?.existingSource) {
      setMode("update");
      setName(data.existingSource.name ?? "");
    } else {
      setMode("create");
      setName("");
    }
  }, [data]);

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

  // ✨ poll summary + logs while jobId is set
  useEffect(() => {
    if (!jobId) return;
    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = async () => {
      try {
        const [s, l] = await Promise.all([
          fetch(`/api/admin/ingest/summary?jobId=${encodeURIComponent(jobId)}`).then((r) =>
            r.json() as Promise<Progress & { lastAt?: string | null }>
          ),
          fetch(`/api/admin/ingest/logs?jobId=${encodeURIComponent(jobId)}&limit=30`).then((r) =>
            r.json() as Promise<{
              logs: Array<{
                created_at?: string;
                event?: string | null;
                message?: string | null;
                detail?: string | null;
                reason?: string | null;
              }>;
            }>
          ),
        ]);

        setProgress({ discovered: s.discovered, upserts: s.upserts, errors: s.errors, done: s.done });

        const lines: TailLine[] = (l.logs ?? []).map((x) => {
          const msg = x.message ?? x.detail ?? (x.reason ? String(x.reason) : "");
          const ev = x.event ? `${x.event}: ` : "";
          return { t: x.created_at ?? "", msg: `${ev}${msg}`.trim() };
        });
        setTail(lines.reverse());

        if (s.done && timer) {
          clearInterval(timer);
          timer = null;
        }
      } catch {
        // swallow; keep polling
      }
    };

    tick();
    timer = setInterval(tick, 2000);
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [jobId]);

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

    const sourceId = mode === "update" ? data.existingSource?.id : undefined;

    // Build updates: only include fields that are set (avoid clobbering with empty strings)
    const updates: NonNullable<CommitPayload["updates"]> = { homepage_url: commitUrl };
    if (name.trim()) updates.name = name.trim();
    if (category.trim()) updates.category = category.trim();
    if (sport.trim()) updates.sport = sport.trim();
    if (allowed !== null) updates.allowed = allowed;
    if (paywall !== null) updates.paywall = paywall;
    if (priority !== "") updates.priority = Number(priority);

    const body: CommitPayload = {
      url: commitUrl,
      method,
      feedUrl: null,
      selector: null,
      nameHint,
      adapterKey: null,
      sourceId,
      upsert: true,
      updates,
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
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      alert(`Commit failed: ${j.error ?? r.statusText}`);
      return;
    }

    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; sourceId?: number; jobId?: string };
    if (j?.sourceId) {
      alert(`Saved! Source #${j.sourceId}`);
    } else {
      alert("Saved!");
    }
    if (j?.jobId) {
      setJobId(j.jobId); // ✨ start polling
    }
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

      {/* Existing-source controls */}
      {data?.existingSource ? (
        <div className="mt-4 rounded-xl border p-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold">Existing source found: #{data.existingSource.id}</div>
              <div className="text-sm text-zinc-600">{data.existingSource.name ?? "(unnamed)"}</div>
            </div>
            <div className="flex gap-6">
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={mode === "update"} onChange={() => setMode("update")} />
                Update existing
              </label>
              <label className="flex items-center gap-2 text-sm opacity-50">
                <input
                  type="radio"
                  disabled={!!data?.existingSource}
                  checked={mode === "create"}
                  onChange={() => setMode("create")}
                />
                Create new
              </label>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input
              className="rounded border p-2"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Source name"
            />
            <input
              className="rounded border p-2"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Category (e.g., news)"
            />
            <input
              className="rounded border p-2"
              value={sport}
              onChange={(e) => setSport(e.target.value)}
              placeholder="Sport (e.g., nfl)"
            />
            <input
              className="rounded border p-2"
              type="number"
              value={priority === "" ? "" : String(priority)}
              onChange={(e) => {
                const v = e.target.value;
                setPriority(v === "" ? "" : Number(v));
              }}
              placeholder="Priority (int)"
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={allowed ?? false}
                onChange={(e) => setAllowed(e.target.checked)}
              />
              Allowed
            </label>
            <select
              className="rounded border p-2"
              value={paywall === null ? "" : paywall ? "yes" : "no"}
              onChange={(e) => setPaywall(e.target.value === "" ? null : e.target.value === "yes")}
            >
              <option value="">Paywall: unknown</option>
              <option value="no">Paywall: no</option>
              <option value="yes">Paywall: yes</option>
            </select>
          </div>
        </div>
      ) : null}

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
                  {f.ok ? "✅" : "❌"} {f.feedUrl} {f.ok ? `(${f.itemCount})` : f.error ? `— ${f.error}` : ""}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded border p-2">
            <b>Scrape selectors</b>
            <ul className="list-disc pl-5">
              {data.scrapes.map((s) => (
                <li key={s.selectorTried}>
                  {s.ok ? "✅" : "❌"} {s.selectorTried} {s.ok ? `(${s.linkCount})` : s.error ? `— ${s.error}` : ""}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded border p-2">
            <b>Adapters</b>
            <ul className="list-disc pl-5">
              {data.adapters.map((a) => (
                <li key={a.key}>
                  {a.ok ? "✅" : "❌"} {a.label ?? a.key} {a.ok ? `(${a.itemCount})` : a.error ? `— ${a.error}` : ""}
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
              title={derived.canUseScrape ? "Create source using the selected CSS selector" : "No viable selector found"}
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

          {/* ✨ Ingest progress / tail */}
          {jobId ? (
            <div className="mt-3 rounded border p-2 text-sm">
              <div className="flex items-center justify-between">
                <div>
                  <b>Ingest running</b> <span className="text-zinc-500">(job {jobId.slice(0, 8)}…)</span>
                  <div className="mt-1 text-zinc-600">
                    Discovered: {progress.discovered} · Upserts: {progress.upserts} · Errors: {progress.errors}
                  </div>
                </div>
                <div
                  className={`px-2 py-1 rounded ${
                    progress.done ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {progress.done ? "Done" : "Working…"}
                </div>
              </div>
              <div className="mt-2 max-h-36 overflow-auto font-mono text-xs">
                {tail.map((x, i) => (
                  <div key={`${i}-${x.t}`}>
                    {x.t ? `${x.t} — ` : ""}
                    {x.msg}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
