"use client";

import { useEffect, useMemo, useState } from "react";
import SelectorTester from "@/components/SelectorTester";

type SourceRow = {
  id: number;
  name: string;
  category: string | null;
  homepage_url: string | null;
  rss_url: string | null;
  scrape_selector?: string | null;
  allowed: boolean | null;
  priority: number | null;
};

const DEFAULT_NFL_SELECTOR = 'a[href*="/nfl/"]';

type EditMap = Record<
  number,
  { homepage_url: string; rss_url: string; scrape_selector: string }
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
        // Defer scroll until rows are present
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

  const toNullIfBlank = (s?: string | null) => {
    const t = (s ?? "").trim();
    return t.length ? t : null;
  };

  const normalizeUrl = (s?: string | null): string | null => {
    const raw = (s ?? "").trim();
    if (!raw) return null;
    // If it parses, keep as-is
    try {
      const u = new URL(raw);
      return u.toString();
    } catch {
      // Try prepending https://
      try {
        const u2 = new URL("https://" + raw.replace(/^\/*/, ""));
        return u2.toString();
      } catch {
        // Fall back to trimmed string (server can reject/clean further)
        return raw;
      }
    }
  };

async function saveRow(id: number) {
  const e = edit[id];
  if (!e) return;

  const current = rows.find((r) => r.id === id);
  if (!current) return;

  // Build normalized values
  const nextHomepage = normalizeUrl(e.homepage_url);
  const nextRss = normalizeUrl(e.rss_url);

  // If user left selector blank, default it when homepage exists and RSS is empty
  const toNullIfBlank = (s?: string | null) => {
    const t = (s ?? "").trim();
    return t.length ? t : null;
  };
  let nextSelector = toNullIfBlank(e.scrape_selector ?? null);

  const homepageFinal = nextHomepage ?? (current.homepage_url ?? null);
  const rssFinal = nextRss ?? (current.rss_url ?? null);

  if (!nextSelector && homepageFinal && !rssFinal) {
    // auto default when scraping is the only ingest path
    nextSelector = DEFAULT_NFL_SELECTOR;
  }

  // Only send changed fields
  const patch: Record<string, unknown> = { id };
  if ((current.homepage_url ?? null) !== nextHomepage) patch.homepage_url = nextHomepage;
  if ((current.rss_url ?? null) !== nextRss) patch.rss_url = nextRss;
  if ((current.scrape_selector ?? null) !== nextSelector) patch.scrape_selector = nextSelector;

  if (Object.keys(patch).length === 1) {
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
    setEdit((m) => ({
      ...m,
      [id]: {
        ...(m[id] ?? {
          homepage_url: rows.find((r) => r.id === id)?.homepage_url ?? "",
          rss_url: rows.find((r) => r.id === id)?.rss_url ?? "",
          scrape_selector: rows.find((r) => r.id === id)?.scrape_selector ?? "",
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
                scrape_selector:
                  s.scrape_selector ??
                  (s.homepage_url && !s.rss_url ? DEFAULT_NFL_SELECTOR : ""),
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
  e: { homepage_url: string; rss_url: string; scrape_selector: string };
  isOpen: boolean;
  isSaving: boolean;
  errorMsg: string | null;
  onToggle: () => void;
  onChange: (p: Partial<typeof e>) => void;
  onSave: () => void;
  onToggleAllowed: (allowed: boolean) => void;
  onApplyDefault: () => void;
}) {
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
              <label className="md:col-span-2 block text-xs text-zinc-600">
                Scrape selector (CSS)
                <input
                  className="mt-1 w-full rounded border border-zinc-300 px-2 py-1 font-mono"
                  value={e.scrape_selector}
                  onChange={(ev) => onChange({ scrape_selector: ev.target.value })}
                  placeholder={DEFAULT_NFL_SELECTOR}
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
              defaultUrl={e.homepage_url || s.homepage_url || ""}
              defaultSelector={e.scrape_selector || s.scrape_selector || DEFAULT_NFL_SELECTOR}
            />
          </td>
        </tr>
      )}
    </>
  );
}
