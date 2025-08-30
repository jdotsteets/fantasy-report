"use client";

import { useEffect, useMemo, useState } from "react";
import SelectorTester from "@/components/SelectorTester";

type SourceRow = {
  id: number;
  name: string;
  category: string | null;
  homepage_url: string | null;
  rss_url: string | null;
  scrape_path?: string | null;
  scrape_selector?: string | null;
  favicon_url?: string | null;
  sitemap_url?: string | null;
  allowed: boolean | null;
  priority: number | null;
};

const DEFAULT_NFL_SELECTOR = 'a[href*="/nfl/"]';

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

type EditMap = Record<
  number,
  {
    homepage_url: string;
    rss_url: string;
    scrape_path: string;
    scrape_selector: string;
    favicon_url: string;
    sitemap_url: string;
    category: string;
    priority: string; // keep as string for the input; coerce to number on save
  }
>;

export default function SourcesTable() {
  const [rows, setRows] = useState<SourceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<number | null>(null);
  const [edit, setEdit] = useState<EditMap>({});
  const [savingIds, setSavingIds] = useState<Set<number>>(new Set());
  const [errorById, setErrorById] = useState<Record<number, string | null>>({});

  async function load() {
    setLoading(true);
    const res = await fetch("/api/admin/sources", { cache: "no-store" });
    const data = (await res.json()) as SourceRow[];
    setRows(data);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  // Open a row when page is visited with #source-<id>
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    if (hash.startsWith("#source-")) {
      const id = Number(hash.replace("#source-", ""));
      if (Number.isFinite(id)) {
        setOpenId(id);
        setTimeout(() => {
          const el = document.getElementById(`source-${id}`);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 0);
      }
    }
  }, [rows.length]);

  async function toggleAllowed(id: number, allowed: boolean) {
    setErrorById((m) => ({ ...m, [id]: null }));
    const res = await fetch("/api/admin/sources", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, allowed }),
    });
    if (res.ok) {
      setRows((r) => r.map((x) => (x.id === id ? { ...x, allowed } : x)));
    } else {
      setErrorById((m) => ({ ...m, [id]: "Failed to update Allowed." }));
    }
  }

  // --- Normalizers ----------------------------------------------------------

  const normalizeUrl = (s?: string | null): string | null => {
    const raw = (s ?? "").trim();
    if (!raw) return null;
    try {
      const u = new URL(raw);
      return u.toString();
    } catch {
      try {
        const u2 = new URL("https://" + raw.replace(/^\/*/, ""));
        return u2.toString();
      } catch {
        return raw.trim();
      }
    }
  };

  const toNullIfBlank = (s?: string | null): string | null => {
    const t = (s ?? "").trim();
    return t.length ? t : null;
  };

  async function saveRow(id: number) {
    const e = edit[id];
    if (!e) return;

    const current = rows.find((r) => r.id === id);
    if (!current) return;

    // Build normalized values
    const nextHomepage = normalizeUrl(e.homepage_url);
    const nextRss = normalizeUrl(e.rss_url);
    const nextScrapePath = toNullIfBlank(e.scrape_path);
    let nextSelector = toNullIfBlank(e.scrape_selector);
    const nextFavicon = normalizeUrl(e.favicon_url);
    const nextSitemap = normalizeUrl(e.sitemap_url);
    const nextCategory = toNullIfBlank(e.category);
    const nextPriority =
      e.priority === "" || e.priority == null
        ? null
        : Number.isFinite(Number(e.priority))
        ? Number(e.priority)
        : (current.priority ?? 0);

    // Default selector if scraping only (homepage && !rss && selector blank)
    const homepageFinal = nextHomepage ?? (current.homepage_url ?? null);
    const rssFinal = nextRss ?? (current.rss_url ?? null);
    if (!nextSelector && homepageFinal && !rssFinal) {
      nextSelector = DEFAULT_NFL_SELECTOR;
    }

    // Only send changed fields
    const patch: Record<string, unknown> = { id };
    if ((current.homepage_url ?? null) !== nextHomepage) patch.homepage_url = nextHomepage;
    if ((current.rss_url ?? null) !== nextRss) patch.rss_url = nextRss;
    if ((current.scrape_path ?? null) !== nextScrapePath) patch.scrape_path = nextScrapePath;
    if ((current.scrape_selector ?? null) !== nextSelector) patch.scrape_selector = nextSelector;
    if ((current.favicon_url ?? null) !== nextFavicon) patch.favicon_url = nextFavicon;
    if ((current.sitemap_url ?? null) !== nextSitemap) patch.sitemap_url = nextSitemap;
    if ((current.category ?? null) !== nextCategory) patch.category = nextCategory;
    if ((current.priority ?? null) !== nextPriority) patch.priority = nextPriority;

    if (Object.keys(patch).length === 1) {
      // nothing changed
      setOpenId(null);
      return;
    }

    setSavingIds((s) => new Set(s).add(id));
    setErrorById((m) => ({ ...m, [id]: null }));

    const res = await fetch("/api/admin/sources", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });

    setSavingIds((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });

    if (res.ok) {
      await load();
      if (typeof window !== "undefined" && window.location.hash === `#source-${id}`) {
        history.replaceState(null, "", window.location.pathname + window.location.search);
      }
      setOpenId(null);
    } else {
      const text = await res.text().catch(() => "");
      setErrorById((m) => ({
        ...m,
        [id]: text ? `Save failed: ${text.slice(0, 160)}` : "Save failed.",
      }));
    }
  }

  function applyDefaultSelector(id: number) {
    const row = rows.find((r) => r.id === id);
    setEdit((m) => ({
      ...m,
      [id]: {
        ...(m[id] ?? {
          homepage_url: row?.homepage_url ?? "",
          rss_url: row?.rss_url ?? "",
          scrape_path: row?.scrape_path ?? "",
          scrape_selector: row?.scrape_selector ?? "",
          favicon_url: row?.favicon_url ?? "",
          sitemap_url: row?.sitemap_url ?? "",
          category: row?.category ?? "",
          priority: String(row?.priority ?? 0),
        }),
        scrape_selector: DEFAULT_NFL_SELECTOR,
      },
    }));
  }

  const sorted = useMemo(
    () =>
      [...rows].sort((a, b) =>
        (a.name ?? "").localeCompare(b.name ?? "", undefined, {
          sensitivity: "base",
          numeric: true,
        })
      ),
    [rows]
  );

  return (
    <section className="rounded-lg border border-zinc-200">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50">
          <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left">
            <th>Name</th>
            <th>Category</th>
            <th>Homepage</th>
            <th>RSS</th>
            <th className="text-center">Allowed</th>
            <th className="text-right">Priority</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={7} className="px-3 py-6 text-center text-zinc-500">
                Loading…
              </td>
            </tr>
          ) : (
            sorted.map((s) => {
              const e = edit[s.id] ?? {
                homepage_url: s.homepage_url ?? "",
                rss_url: s.rss_url ?? "",
                scrape_path: s.scrape_path ?? "",
                scrape_selector:
                  s.scrape_selector ??
                  (s.homepage_url && !s.rss_url ? DEFAULT_NFL_SELECTOR : ""),
                favicon_url: s.favicon_url ?? "",
                sitemap_url: s.sitemap_url ?? "",
                category: s.category ?? "",
                priority: String(s.priority ?? 0),
              };
              const isOpen = openId === s.id;
              const isSaving = savingIds.has(s.id);
              const err = errorById[s.id] ?? null;

              return (
                <FragmentRow
                  key={s.id}
                  anchorId={`source-${s.id}`}
                  s={s}
                  e={e}
                  isOpen={isOpen}
                  isSaving={isSaving}
                  errorMsg={err}
                  onToggle={() => setOpenId(isOpen ? null : s.id)}
                  onChange={(patch) =>
                    setEdit((m) => ({ ...m, [s.id]: { ...e, ...patch } }))
                  }
                  onSave={() => saveRow(s.id)}
                  onToggleAllowed={(allowed) => toggleAllowed(s.id, allowed)}
                  onApplyDefault={() => applyDefaultSelector(s.id)}
                />
              );
            })
          )}
        </tbody>
      </table>
    </section>
  );
}

function FragmentRow({
  anchorId,
  s,
  e,
  isOpen,
  isSaving,
  errorMsg,
  onToggle,
  onChange,
  onSave,
  onToggleAllowed,
  onApplyDefault,
}: {
  anchorId: string;
  s: SourceRow;
  e: {
    homepage_url: string;
    rss_url: string;
    scrape_path: string;
    scrape_selector: string;
    favicon_url: string;
    sitemap_url: string;
    category: string;
    priority: string;
  };
  isOpen: boolean;
  isSaving: boolean;
  errorMsg: string | null;
  onToggle: () => void;
  onChange: (p: Partial<typeof e>) => void;
  onSave: () => void;
  onToggleAllowed: (allowed: boolean) => void;
  onApplyDefault: () => void;
}) {
  // Build effective URL for SelectorTester using homepage + scrape_path.
  const effectiveTestUrl = (() => {
    const base = e.homepage_url || s.homepage_url || "";
    const path = e.scrape_path || s.scrape_path || "";
    if (!base) return base;
    try {
      return path ? new URL(path, base).toString() : base;
    } catch {
      return base;
    }
  })();

  return (
    <>
      <tr id={anchorId} className="border-t">
        <td className="px-3 py-2">{s.name}</td>
        <td className="px-3 py-2">{s.category ?? "—"}</td>
        <td className="px-3 py-2">
          {s.homepage_url ? (
            <a
              href={s.homepage_url}
              target="_blank"
              rel="noreferrer"
              className="text-blue-700 hover:underline"
            >
              Homepage
            </a>
          ) : (
            "—"
          )}
        </td>
        <td className="px-3 py-2">
          {s.rss_url ? (
            <a
              href={s.rss_url}
              target="_blank"
              rel="noreferrer"
              className="text-blue-700 hover:underline"
            >
              RSS
            </a>
          ) : (
            "—"
          )}
        </td>
        <td className="px-3 py-2 text-center">
          <button
            onClick={() => onToggleAllowed(!(s.allowed ?? true))}
            className={`rounded px-2 py-1 ${
              s.allowed ? "bg-green-100 text-green-800" : "bg-zinc-200 text-zinc-600"
            }`}
          >
            {s.allowed ? "Yes" : "No"}
          </button>
        </td>
        <td className="px-3 py-2 text-right">{s.priority ?? 0}</td>
        <td className="px-3 py-2">
          <button
            onClick={onToggle}
            className="rounded border border-zinc-300 px-2 py-1 hover:bg-zinc-50"
          >
            {isOpen ? "Close" : "Edit"}
          </button>
        </td>
      </tr>

      {isOpen && (
        <tr className="border-t bg-zinc-50">
          <td colSpan={7} className="px-3 py-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="block text-xs text-zinc-600">
                Homepage URL
                <input
                  className="mt-1 w-full rounded border border-zinc-300 px-2 py-1"
                  value={e.homepage_url}
                  onChange={(ev) => onChange({ homepage_url: ev.target.value })}
                  placeholder="https://site.com/nfl/"
                />
              </label>
              <label className="block text-xs text-zinc-600">
                RSS URL
                <input
                  className="mt-1 w-full rounded border border-zinc-300 px-2 py-1"
                  value={e.rss_url}
                  onChange={(ev) => onChange({ rss_url: ev.target.value })}
                  placeholder="https://site.com/feed.xml"
                />
              </label>

              <label className="block text-xs text-zinc-600">
                Scrape path (optional)
                <input
                  className="mt-1 w-full rounded border border-zinc-300 px-2 py-1"
                  value={e.scrape_path}
                  onChange={(ev) => onChange({ scrape_path: ev.target.value })}
                  placeholder="/articles/fantasy"
                />
              </label>
              <label className="block text-xs text-zinc-600 md:col-span-2">
                Scrape selector (CSS)
                <input
                  className="mt-1 w-full rounded border border-zinc-300 px-2 py-1 font-mono"
                  value={e.scrape_selector}
                  onChange={(ev) => onChange({ scrape_selector: ev.target.value })}
                  placeholder={DEFAULT_NFL_SELECTOR}
                />
              </label>

              <label className="block text-xs text-zinc-600">
                Favicon URL (optional)
                <input
                  className="mt-1 w-full rounded border border-zinc-300 px-2 py-1"
                  value={e.favicon_url}
                  onChange={(ev) => onChange({ favicon_url: ev.target.value })}
                  placeholder="https://site.com/favicon.ico"
                />
              </label>
              <label className="block text-xs text-zinc-600">
                Sitemap URL (optional)
                <input
                  className="mt-1 w-full rounded border border-zinc-300 px-2 py-1"
                  value={e.sitemap_url}
                  onChange={(ev) => onChange({ sitemap_url: ev.target.value })}
                  placeholder="https://site.com/sitemap.xml"
                />
              </label>

              <label className="block text-xs text-zinc-600">
                Category (optional)
                <select
                  className="mt-1 w-full rounded border border-zinc-300 px-2 py-1"
                  value={e.category}
                  onChange={(ev) => onChange({ category: ev.target.value })}
                >
                  {CATEGORY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-zinc-600">
                Priority
                <input
                  className="mt-1 w-full rounded border border-zinc-300 px-2 py-1"
                  type="number"
                  inputMode="numeric"
                  value={e.priority}
                  onChange={(ev) => onChange({ priority: ev.target.value })}
                />
              </label>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onSave}
                disabled={isSaving}
                className={`rounded px-3 py-1.5 text-white ${
                  isSaving
                    ? "bg-emerald-400 opacity-70"
                    : "bg-emerald-600 hover:bg-emerald-700"
                }`}
              >
                {isSaving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={onApplyDefault}
                className="rounded border border-emerald-600 px-3 py-1.5 text-emerald-700 hover:bg-emerald-50"
                title={`Sets ${DEFAULT_NFL_SELECTOR}`}
              >
                Apply default NFL selector
              </button>
              {errorMsg ? (
                <span className="text-xs text-rose-700">{errorMsg}</span>
              ) : null}
            </div>

            <SelectorTester
              sourceId={s.id}
              defaultUrl={effectiveTestUrl}
              defaultSelector={
                e.scrape_selector || s.scrape_selector || DEFAULT_NFL_SELECTOR
              }
            />
          </td>
        </tr>
      )}
    </>
  );
}
