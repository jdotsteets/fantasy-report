"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Filter } from "lucide-react";

type SourceRow = {
  id: number;
  name: string;
  homepage_url: string | null;
  favicon_url?: string | null;
};

function ddgFavicon(u: string | null | undefined) {
  if (!u) return null;
  try {
    const host = new URL(u).hostname;
    return `https://icons.duckduckgo.com/ip3/${host}.ico`;
  } catch {
    return null;
  }
}

export default function SourcePickerButton() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const chosenId = useMemo(() => {
    const raw = sp.get("sourceId");
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  }, [sp]);

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [q, setQ] = useState("");

  // Close the menu if URL changes (e.g., after picking a source)
  useEffect(() => setOpen(false), [pathname, sp]);

  // Fetch a lightweight list of sources once (adjust the URL to your API if needed)
  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        // Prefer a public, read-only list. If you don’t have one yet,
        // you can temporarily reuse /api/admin/sources (GET) and select fields client-side.
        const r = await fetch("/api/home/sources?fields=id,name,homepage_url,favicon_url", {
          cache: "no-store",
        });
        const list = (await r.json()) as SourceRow[];
        if (!cancel) setSources(Array.isArray(list) ? list : []);
      } catch {
        if (!cancel) setSources([]);
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  // Basic filter
  const filtered = useMemo(() => {
    const needle = q.toLowerCase().trim();
    if (!needle) return sources;
    return sources.filter((s) => s.name.toLowerCase().includes(needle));
  }, [sources, q]);

  function applySource(id: number | null) {
    const url = new URL(window.location.href);
    if (id == null) url.searchParams.delete("sourceId");
    else url.searchParams.set("sourceId", String(id));
    router.push(url.pathname + "?" + url.searchParams.toString());
  }

  // Determine current label
  const currentName =
    chosenId != null
      ? sources.find((s) => s.id === chosenId)?.name ?? `#${chosenId}`
      : null;

  // Click-away close
  const popRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-100"
        title={currentName ? `Source: ${currentName}` : "Filter by source"}
        aria-expanded={open}
      >
        <Filter size={18} />
        <span className="hidden sm:block">
          {currentName ? truncate(currentName, 18) : "Source"}
        </span>
      </button>

      {open ? (
        <div
          ref={popRef}
          className="absolute right-0 mt-2 w-[280px] rounded-xl border border-zinc-200 bg-white p-2 shadow-lg"
        >
          <div className="mb-2 flex items-center gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search sources…"
              className="w-full rounded-md border border-zinc-200 px-2 py-1 text-sm outline-none focus:border-zinc-400"
            />
            {chosenId != null ? (
              <button
                onClick={() => applySource(null)}
                className="shrink-0 rounded-md bg-zinc-100 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-200"
                title="Clear filter"
              >
                Clear
              </button>
            ) : null}
          </div>

          <div className="max-h-72 overflow-auto">
            {loading ? (
              <div className="px-2 py-3 text-sm text-zinc-600">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="px-2 py-3 text-sm text-zinc-600">No matches.</div>
            ) : (
              <ul className="divide-y divide-zinc-100">
                {filtered.map((s) => {
                  const ico = s.favicon_url || ddgFavicon(s.homepage_url);
                  const active = chosenId === s.id;
                  return (
                    <li key={s.id}>
                      <button
                        onClick={() => applySource(s.id)}
                        className={`flex w-full items-center gap-2 px-2 py-2 text-left text-sm hover:bg-zinc-50 ${
                          active ? "text-emerald-700" : "text-zinc-800"
                        }`}
                      >
                        {ico ? (
                          <img
                            src={ico}
                            alt=""
                            width={16}
                            height={16}
                            className="shrink-0 rounded"
                            loading="lazy"
                          />
                        ) : (
                          <span className="mr-[2px] inline-block h-4 w-4 shrink-0 rounded bg-zinc-200" />
                        )}
                        <span className="truncate">{s.name}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
