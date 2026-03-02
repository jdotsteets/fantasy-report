//app/admin/hero/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { AdminNav } from "@/components/admin/AdminNav";

/* ───────────────────────── Types ───────────────────────── */

type CurrentHeroResp =
  | {
      mode: "manual" | "auto" | "empty" | "fallback";
      hero: {
        title: string;
        href: string;
        src?: string;
        source?: string;
      } | null;
      createdAt?: string | null;
      expiresAt?: string | null;
    }
  | { error: string };

type SectionRow = {
  id: number;
  title: string | null;
  url: string;
  canonical_url: string | null;
  domain: string | null;
  image_url: string | null;
  published_at: string | null;
  discovered_at: string | null;
  source: string | null;
  topics: string[] | null;
  week: number | null;
  is_player_page?: boolean | null;
  primary_topic: string | null;
  secondary_topic: string | null;
};

type SectionApiResp = { items: SectionRow[] } | { error: string };


/* ───────────────────────── Helpers ───────────────────────── */

function relTime(iso?: string | null): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const diffMs = Date.now() - t;
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

function classNames(...xs: Array<string | false | null | undefined>): string {
  return xs.filter(Boolean).join(" ");
}

function chooseHref(r: SectionRow): string {
  return r.canonical_url || r.url;
}

/* ───────────────────────── Page ───────────────────────── */

export default function AdminHeroPage() {
  const [url, setUrl] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const [msg, setMsg] = useState<string>("");

  // preview data
  const [current, setCurrent] = useState<CurrentHeroResp | null>(null);
  const [news, setNews] = useState<SectionRow[] | null>(null);
  const [loadingPreview, setLoadingPreview] = useState<boolean>(false);
  const [previewErr, setPreviewErr] = useState<string>("");

  /* ── actions ── */

  async function setManual(manualUrl?: string) {
    const useUrl = (manualUrl ?? url).trim();
    if (!useUrl) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/hero/set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: useUrl }),
      });
      const j: { ok?: boolean; error?: string } = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error(j.error ?? "Failed");
      setMsg("Hero set.");
      setUrl("");
      // refresh preview
      void loadPreview();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function forceAuto() {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/hero/auto", { method: "POST" });
      const j: { ok?: boolean; error?: string } = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error(j.error ?? "Failed");
      setMsg("Auto hero will be used on next load.");
      // refresh preview
      void loadPreview();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /* ── preview loader ── */

  async function loadPreview() {
    setLoadingPreview(true);
    setPreviewErr("");
    try {
      const [heroRes, newsRes] = await Promise.allSettled([
        fetch("/api/hero/current", { cache: "no-store" }),
        // If you have /api/section, this will work. If not, panel shows an instruction.
        fetch("/api/section?key=news&limit=36&days=3", { cache: "no-store" }),
      ]);

      if (heroRes.status === "fulfilled") {
        const j = (await heroRes.value.json()) as CurrentHeroResp;
        setCurrent(j);
      } else {
        setCurrent({ error: heroRes.reason?.message ?? "Failed to load current hero" });
      }

    if (newsRes.status === "fulfilled") {
  const j = (await newsRes.value.json()) as SectionApiResp;
  if ("items" in j) {
    setNews(j.items);
  } else {
    setPreviewErr(j.error ?? "Failed to load news");
  }
} else {
  setPreviewErr("News endpoint not found. Add /api/section?key=news or share an endpoint I can call.");
}
    } catch (err) {
      setPreviewErr((err as Error).message);
    } finally {
      setLoadingPreview(false);
    }
  }

  useEffect(() => {
    void loadPreview();
  }, []);

  // naive scoring to bubble “breaking” headlines to the top of preview
  const scoredNews = useMemo(() => {
    if (!news) return [];
    const now = Date.now();
    return [...news]
      .map((r) => {
        const t = `${r.title ?? ""}`.toLowerCase();
        const ts = r.published_at ? Date.parse(r.published_at) : now - 86_400_000;
        const hoursOld = Math.max(0, (now - ts) / 3.6e6);
        let score = 0;
        if (
          /breaking|news|per\s+source|ruled\s+out|injury|carted|trade|signed|released|activated|designated/i.test(t)
        )
          score += 50;
        if (/actives|inactives|status|game-time/i.test(t)) score += 20;
        score += Math.max(0, 40 - hoursOld * 3);
        if (r.image_url) score += 5;
        return { r, score };
      })
      .sort((a, b) => b.score - a.score)
      .map((x) => x.r);
  }, [news]);

  /* ───────────────────────── Render ───────────────────────── */

  return (
    <main className="p-6 space-y-6">
      <AdminNav active="hero" />
      <h1 className="text-2xl font-semibold">Hero Controls</h1>

      {/* Controls */}
      <section className="space-y-3">
        <label className="block text-sm font-medium">Paste article URL</label>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="w-full max-w-xl rounded-xl border px-3 py-2"
          placeholder="https://example.com/article"
        />
        <div className="flex items-center gap-2">
          <button
            className="px-3 py-1 rounded-xl bg-black text-white disabled:opacity-50"
            onClick={() => setManual()}
            disabled={busy || !url}
            title="Use this URL as the hero now"
          >
            Use as Hero
          </button>
          <button
            className="px-3 py-1 rounded-xl border disabled:opacity-50"
            onClick={forceAuto}
            disabled={busy}
            title="Clear manual and use Auto (Breaking) immediately"
          >
            New Hero (Auto · Breaking)
          </button>
        </div>
        {msg ? <p className="text-sm text-gray-700">{msg}</p> : null}
        <p className="text-xs text-gray-500">
          Manual heroes stick for ~6 hours. Auto mode favors fresh Breaking/News/Injury headlines and rotates hourly.
        </p>
      </section>

      {/* Preview */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Preview</h2>
          <button
            className="px-3 py-1 rounded-xl border text-sm disabled:opacity-50"
            onClick={() => loadPreview()}
            disabled={loadingPreview}
          >
            Refresh
          </button>
        </div>

        {/* Current hero card */}
        <div className="rounded-2xl border p-4">
          <h3 className="text-sm font-semibold mb-3">Current Hero</h3>
          {!current ? (
            <p className="text-sm text-gray-500">Loading current hero…</p>
          ) : "error" in current ? (
            <p className="text-sm text-red-600">Error: {current.error}</p>
          ) : current.hero ? (
            <div className="flex gap-4">
              <div className="w-40 h-24 bg-gray-100 rounded-xl overflow-hidden flex items-center justify-center">
                {current.hero.src ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={current.hero.src}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-xs text-gray-400">no image</span>
                )}
              </div>
              <div className="flex-1">
                <div className="text-xs uppercase tracking-wide text-gray-500">
                  {current.mode}
                </div>
                <a
                  className="block font-medium hover:underline"
                  href={current.hero.href}
                  target="_blank"
                  rel="noreferrer"
                >
                  {current.hero.title}
                </a>
                <div className="text-xs text-gray-500 mt-1">
                  {current.hero.source || "The Fantasy Report"}
                  {current.createdAt ? ` • set ${relTime(current.createdAt)}` : ""}
                  {current.expiresAt ? ` • expires ${relTime(current.expiresAt)}` : ""}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500">No hero selected.</p>
          )}
        </div>

        {/* News candidates */}
        <div className="rounded-2xl border p-4">
          <h3 className="text-sm font-semibold mb-3">News Candidates</h3>
          {previewErr && (
            <p className="text-sm text-amber-700 mb-2">
              {previewErr}
            </p>
          )}
          {!scoredNews.length ? (
            <p className="text-sm text-gray-500">
              {loadingPreview ? "Loading news…" : "No news items loaded."}
            </p>
          ) : (
            <ul className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
              {scoredNews.map((r) => (
                <li key={r.id} className="rounded-xl border p-3 flex gap-3">
                  <div className="w-24 h-16 bg-gray-100 rounded-lg overflow-hidden flex items-center justify-center shrink-0">
                    {r.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.image_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-[10px] text-gray-400">no image</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <a
                      href={chooseHref(r)}
                      target="_blank"
                      rel="noreferrer"
                      className="block font-medium leading-snug hover:underline line-clamp-2"
                      title={r.title ?? ""}
                    >
                      {r.title ?? "(untitled)"}
                    </a>
                    <div className="text-xs text-gray-500 mt-1">
                      {r.source || r.domain || "source"} • {relTime(r.published_at)}
                    </div>
                    <div className="mt-2">
                      <button
                        className="px-2 py-1 rounded-lg bg-black text-white text-xs"
                        onClick={() => setManual(chooseHref(r))}
                        title="Use this as the site hero"
                      >
                        Use as Hero
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
