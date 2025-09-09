// components/SourceTab.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";
import { Filter } from "lucide-react";

type Row = {
  id: number;
  name: string;
  homepage_url: string | null;
  favicon_url?: string | null;
  category?: string | null;
};

function domainFromUrl(u: string | null): string | null {
  if (!u) return null;
  try {
    return new URL(u).hostname;
  } catch {
    return null;
  }
}
function faviconUrl(row: Row): string | null {
  if (row.favicon_url) return row.favicon_url;
  const d = domainFromUrl(row.homepage_url);
  return d ? `https://icons.duckduckgo.com/ip3/${d}.ico` : null;
}

export default function SourceTab() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const currentSection = sp.get("section") ?? undefined;
  const currentSource = sp.get("sourceId");

  // UI
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  // Panel position
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const recalc = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const panelW = 320; // match width below
    const margin = 8;
    const top = r.bottom + margin;
    const left = Math.min(Math.max(r.left, margin), window.innerWidth - panelW - margin);
    setCoords({ top, left });
  };

  useEffect(() => {
    if (!open) return;
    recalc();
    const on = () => recalc();
    window.addEventListener("resize", on);
    window.addEventListener("scroll", on, { passive: true });
    return () => {
      window.removeEventListener("resize", on);
      window.removeEventListener("scroll", on);
    };
  }, [open]);

  // Data
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!open || rows.length) return;
    (async () => {
      try {
        setLoading(true);
        const r = await fetch("/api/home/sources?nonTeam=1", { cache: "no-store" });
        const j = (await r.json()) as Row[];
        setRows(Array.isArray(j) ? j : []);
      } finally {
        setLoading(false);
      }
    })();
  }, [open, rows.length]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(needle));
  }, [rows, q]);

  // Apply selection
  const apply = (sourceId: number | null) => {
    const params = new URLSearchParams(sp.toString());
    if (sourceId == null) params.delete("sourceId");
    else params.set("sourceId", String(sourceId));
    // preserve section if present
    if (currentSection) params.set("section", currentSection);
    router.push(`${pathname}?${params.toString()}`);
    setOpen(false);
  };

  const activeClass =
    "flex flex-col items-center gap-1 rounded-xl px-3 py-2 text-xs bg-zinc-900 text-white";
  const idleClass =
    "flex flex-col items-center gap-1 rounded-xl px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-100";

  return (
    <>
      {/* Toolbar button (looks like the others) */}
      <li className="flex-1 min-w-[68px]">
        <button
          ref={btnRef}
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={currentSource ? activeClass : idleClass}
          aria-expanded={open}
          aria-haspopup="dialog"
        >
          <Filter size={18} aria-hidden="true" />
          <span className="hidden sm:block">Source</span>
        </button>
      </li>

      {/* Portal popover */}
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] bg-black/0"
            onClick={() => setOpen(false)}
            aria-label="Close source picker"
          >
            <div
              className="fixed z-[101] w-[320px] max-h-[60vh] overflow-auto rounded-2xl border border-zinc-200 bg-white shadow-xl"
              style={{ top: coords.top, left: coords.left }}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
            >
              <div className="sticky top-0 bg-white/90 backdrop-blur p-2 border-b">
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search sources…"
                  className="w-full rounded-md border border-zinc-300 px-2 py-1 text-sm"
                  autoFocus
                />
              </div>

              <ul className="p-2">
                <li>
                  <button
                    className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-zinc-100"
                    onClick={() => apply(null)}
                  >
                    <span className="inline-block h-[18px] w-[18px] rounded border border-zinc-300" />
                    <span className="font-medium text-emerald-700">All sources</span>
                  </button>
                </li>
                {loading ? (
                  <li className="px-2 py-2 text-sm text-zinc-500">Loading…</li>
                ) : filtered.length === 0 ? (
                  <li className="px-2 py-2 text-sm text-zinc-500">No matches.</li>
                ) : (
                  filtered.map((r) => (
                    <li key={r.id}>
                      <button
                        className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-zinc-100"
                        onClick={() => apply(r.id)}
                        title={r.name}
                      >
                        {(() => {
                          const u = faviconUrl(r);
                          return u ? (
                            <img
                              src={u}
                              alt=""
                              width={18}
                              height={18}
                              className="shrink-0 rounded"
                              loading="lazy"
                            />
                          ) : (
                            <span className="inline-block h-[18px] w-[18px] rounded border border-zinc-300" />
                          );
                        })()}
                        <span className="truncate">{r.name}</span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
