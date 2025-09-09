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

  // user picks for method variants
  const [selectedFeed, setSelectedFeed] = useState<string | null>(null);
  const [selectedSelector, setSelectedSelector] = useState<string | null>(null);
  const [selectedAdapterKey, setSelectedAdapterKey] = useState<string | null>(null);

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

  // helper: score feeds to prefer NFL/football paths
  function feedScore(u: string): number {
    let s = 0;
    if (/\/nfl(\/|$)/i.test(u) || /\bnfl\b/i.test(u)) s += 5;
    if (/football/i.test(u)) s += 2;
    if (/(nba|mlb|nhl|soccer|mls|ncaa)/i.test(u)) s -= 1;
    return s;
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

    const feedsSorted = [...data.feeds].sort((a, b) => {
      // prefer nfl/football first, then by itemCount
      const s = feedScore(b.feedUrl) - feedScore(a.feedUrl);
      if (s !== 0) return s;
      return (b.itemCount || 0) - (a.itemCount || 0);
    });
    const bestFeed = feedsSorted.find((f) => f.ok) ?? null;

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

  // When data changes, preselect sensible defaults (prefer NFL feed and best selector/adapter)
  useEffect(() => {
    if (!data) {
      setSelectedFeed(null);
      setSelectedSelector(null);
      setSelectedAdapterKey(null);
      return;
    }

    // feeds
    const nflFav =
      [...data.feeds]
        .filter((f) => f.ok)
        .sort((a, b) => {
          const s = feedScore(b.feedUrl) - feedScore(a.feedUrl);
          if (s !== 0) return s;
          return (b.itemCount || 0) - (a.itemCount || 0);
        })[0]?.feedUrl ?? null;

    const recFeed = data.recommended.feedUrl ?? null;
    setSelectedFeed(recFeed ?? nflFav ?? derived.bestFeed?.feedUrl ?? null);

    // selectors
    const recSel = data.recommended.selector ?? null;
    const bestSel =
      data.scrapes.filter((s) => s.ok).sort((a, b) => b.linkCount - a.linkCount)[0]?.selectorTried ??
      null;
    setSelectedSelector(recSel ?? bestSel ?? null);

    // adapters
const bestAdapterKey =
  data.adapters
    .filter((a) => a.ok)
    .sort((a, b) => (b.itemCount || 0) - (a.itemCount || 0))[0]?.key ?? null;

const recAdapterKey =
  data.recommended.method === "adapter" ? bestAdapterKey : null;

setSelectedAdapterKey(recAdapterKey ?? bestAdapterKey ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      // 👇 prefer the user’s pick; fall back to recommended/best
      body.feedUrl =
        selectedFeed ??
        data.recommended.feedUrl ??
        derived.bestFeed?.feedUrl ??
        null;
    }
    if (method === "scrape") {
      // 👇 prefer the user’s pick; fall back to recommended/best
      body.selector =
        selectedSelector ??
        data.recommended.selector ??
        derived.bestScrape?.selectorTried ??
        null;
    }
    if (method === "adapter") {
      // 👇 prefer the user’s pick; fall back to best adapter
      body.adapterKey =
        selectedAdapterKey ??
        (derived.bestAdapter ? derived.bestAdapter.key : null);
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
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
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
            <div className="mt-1 space-y-1">
              {data.feeds.length === 0 ? (
                <div className="text-zinc-500">No feeds found.</div>
              ) : (
                data.feeds.map((f) => {
                  const disabled = !f.ok;
                  return (
                    <label key={f.feedUrl} className={`flex items-center gap-2 py-1 ${disabled ? "opacity-50" : ""}`}>
                      <input
                        type="radio"
                        name="feedChoice"
                        value={f.feedUrl}
                        disabled={disabled}
                        checked={selectedFeed === f.feedUrl}
                        onChange={() => setSelectedFeed(f.feedUrl)}
                      />
                      <span className="truncate">{f.feedUrl}</span>
                      <span className="text-xs text-zinc-500">{f.ok ? `(${f.itemCount})` : f.error ? `— ${f.error}` : ""}</span>
                    </label>
                  );
                })
              )}
            </div>
          </div>

          <div className="rounded border p-2">
            <b>Scrape selectors</b>
            <div className="mt-1 space-y-1">
              {data.scrapes.length === 0 ? (
                <div className="text-zinc-500">No selectors tried.</div>
              ) : (
                data.scrapes.map((s) => {
                  const disabled = !s.ok;
                  return (
                    <label key={s.selectorTried} className={`flex items-center gap-2 py-1 ${disabled ? "opacity-50" : ""}`}>
                      <input
                        type="radio"
                        name="selChoice"
                        value={s.selectorTried}
                        disabled={disabled}
                        checked={selectedSelector === s.selectorTried}
                        onChange={() => setSelectedSelector(s.selectorTried)}
                      />
                      <code className="font-mono">{s.selectorTried}</code>
                      <span className="text-xs text-zinc-500">{s.ok ? `(${s.linkCount})` : s.error ? `— ${s.error}` : ""}</span>
                    </label>
                  );
                })
              )}
            </div>
          </div>

          <div className="rounded border p-2">
            <b>Adapters</b>
            <div className="mt-1 space-y-1">
              {data.adapters.length === 0 ? (
                <div className="text-zinc-500">No adapters matched.</div>
              ) : (
                data.adapters.map((a) => {
                  const disabled = !a.ok;
                  return (
                    <label key={a.key} className={`flex items-center gap-2 py-1 ${disabled ? "opacity-50" : ""}`}>
                      <input
                        type="radio"
                        name="adapterChoice"
                        value={a.key}
                        disabled={disabled}
                        checked={selectedAdapterKey === a.key}
                        onChange={() => setSelectedAdapterKey(a.key)}
                      />
                      <span className="truncate">{a.label ?? a.key}</span>
                      <span className="text-xs text-zinc-500">{a.ok ? `(${a.itemCount})` : a.error ? `— ${a.error}` : ""}</span>
                    </label>
                  );
                })
              )}
            </div>
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
              title={derived.canUseRss ? "Create/update source using RSS (uses your selected feed)" : "No working feed detected"}
            >
              Use RSS{derived.bestFeed ? ` (${derived.bestFeed.itemCount})` : ""}
            </button>

            <button
              onClick={() => derived.canUseScrape && commit("scrape")}
              disabled={!derived.canUseScrape}
              className={btnClass("scrape", derived.canUseScrape)}
              title={derived.canUseScrape ? "Create/update source using the selected CSS selector" : "No viable selector found"}
            >
              Use Scrape{derived.bestScrape ? ` (${derived.bestScrape.linkCount})` : ""}
            </button>

            <button
              onClick={() => derived.canUseAdapter && commit("adapter")}
              disabled={!derived.canUseAdapter}
              className={btnClass("adapter", derived.canUseAdapter)}
              title={derived.canUseAdapter ? "Create/update source with selected adapter (merges endpoint if updating)" : "No adapter matched"}
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
