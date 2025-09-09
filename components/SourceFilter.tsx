"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type Item = { id: number; name: string; href?: string | null; icon?: string | null };

export default function SourceFilter() {
  const sp = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const initialId = Number(sp.get("sourceId") || "") || null;

  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<number | null>(initialId);

  useEffect(() => {
    (async () => {
      const r = await fetch("/api/home/sources", { cache: "no-store" });
      const j = await r.json().catch(() => ({ items: [] }));
      setItems(j.items || []);
    })();
  }, []);

  // search filter
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((i) => i.name.toLowerCase().includes(needle));
  }, [q, items]);

  function apply(id: number | null) {
    setSelected(id);
    const p = new URLSearchParams(sp.toString());
    if (id) p.set("sourceId", String(id));
    else p.delete("sourceId");
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
    setOpen(false);
  }

  const label =
    selected ? items.find((i) => i.id === selected)?.name ?? `Source #${selected}` : "All sources";

  return (
    <div className="relative">
      {/* Trigger button (sits in the top nav) */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm hover:bg-zinc-50"
        title="Filter by source"
      >
        <span className="i-mdi-database-outline" aria-hidden />
        <span className="hidden sm:inline">{label}</span>
        <span className="sm:hidden">Source</span>
      </button>

      {open && (
        <div
          className="absolute right-0 z-50 mt-2 w-72 rounded-xl border bg-white p-2 shadow-xl"
          onMouseLeave={() => setOpen(false)}
        >
          <div className="mb-2 flex items-center gap-2">
            <input
              placeholder="Search sources…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-8 flex-1 rounded border px-2 text-sm"
            />
            {selected && (
              <button
                className="h-8 rounded border px-2 text-xs hover:bg-zinc-50"
                onClick={() => apply(null)}
                title="Clear filter"
              >
                Clear
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-auto">
            {filtered.length === 0 ? (
              <div className="p-2 text-sm text-zinc-600">No matches.</div>
            ) : (
              <ul className="divide-y text-sm">
                {filtered.map((s) => (
                  <li key={s.id}>
                    <button
                      onClick={() => apply(s.id)}
                      className="flex w-full items-center gap-2 px-2 py-2 text-left hover:bg-zinc-50"
                    >
                      {s.icon ? (
                        <img
                          src={s.icon}
                          alt=""
                          width={16}
                          height={16}
                          className="rounded"
                          loading="lazy"
                        />
                      ) : (
                        <span className="inline-block h-3 w-3 rounded-full bg-zinc-300" />
                      )}
                      <span className="truncate">{s.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
