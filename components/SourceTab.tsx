// components/SourceTab.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";
import { Filter, Check } from "lucide-react";

/* ───────── Types ───────── */
type ProviderRow = { provider: string; count: number };

/* ───────── Type guards ───────── */
function isProviderRow(v: unknown): v is ProviderRow {
  return (
    typeof v === "object" &&
    v !== null &&
    "provider" in v &&
    typeof (v as { provider: unknown }).provider === "string" &&
    "count" in v &&
    typeof (v as { count: unknown }).count === "number"
  );
}
function parseProvidersJson(j: unknown): ProviderRow[] {
  if (Array.isArray(j) && j.every(isProviderRow)) return j;
  if (
    typeof j === "object" &&
    j !== null &&
    "providers" in j &&
    Array.isArray((j as { providers: unknown }).providers) &&
    (j as { providers: unknown[] }).providers.every(isProviderRow)
  ) {
    return (j as { providers: ProviderRow[] }).providers;
  }
  return [];
}

/* ───────── Favicon helpers ───────── */
const PROVIDER_DOMAIN: Record<string, string> = {
  "CBS Sports": "cbssports.com",
  ESPN: "espn.com",
  "Yahoo Sports": "yahoo.com",
  "NFL.com": "nfl.com",
  "NBC Sports": "nbcsports.com",
  "The Athletic": "theathletic.com",
  "The Ringer": "theringer.com",
  "Fantasy Pros": "fantasypros.com",
  "Player Profiler": "playerprofiler.com",
  Rotowire: "rotowire.com",
  "Roto Wire": "rotowire.com",
  Rotoballer: "rotoballer.com",
  NumberFire: "numberfire.com",
  PFF: "pff.com",
  "Draft Sharks": "draftsharks.com",
  "Fantasy Alarm": "fantasyalarm.com",
  "Establish The Run": "establishtherun.com",
  Razzball: "razzball.com",
  "The Draft Network": "thedraftnetwork.com",
  "Pro Football Reference": "pro-football-reference.com",
  "SI.com": "si.com",
  "USA Today": "usatoday.com",
  "Fan Duel": "fanduel.com",
  "Prize Picks": "prizepicks.com",
  "Roto Street Journal": "rotostreetjournal.com",
  SharpFootball: "sharpfootballanalysis.com",
  "Football Outsiders": "footballoutsiders.com",
  "Fantasy Life": "fantasylife.com",
  "Fantasy Data": "fantasydata.com",
  "Football Guys": "footballguys.com",
  "Fantasy Nerds": "fantasynerds.com",
  FFToday: "fftoday.com",
  "Draft Countdown": "draftcountdown.com",
  "4for4": "4for4.com",
  "Pro Football Rumors": "profootballrumors.com",
  "Fantasy SP": "fantasysp.com",
  TWSN: "twsn.net",
};

function faviconFromProvider(provider: string): string | null {
  const known = PROVIDER_DOMAIN[provider];
  if (known) return `https://icons.duckduckgo.com/ip3/${known}.ico`;
  const trimmed = provider.trim();
  if (/[.]/.test(trimmed)) return `https://icons.duckduckgo.com/ip3/${trimmed.toLowerCase()}.ico`;
  return null; // let fallback icon show
}

function FootballIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" className={className}>
      <path d="M19.8 4.2C16.9 1.3 8.6 2.4 5.4 5.6 2.2 8.8 1.3 17.1 4.2 20c2.9 2.9 11.2 1.9 14.4-1.3 3.2-3.2 4.1-11.5 1.2-14.5Z" fill="currentColor" opacity="0.2"/>
      <path d="M14.5 4.5c-1.9-.2-4.2.5-6 2.3-1.8 1.8-2.5 4.2-2.3 6 .1.7.9.9 1.4.4l8.8-8.8c.5-.5.3-1.3-.4-1.4Zm3 3-8.8 8.8c-.5.5-.3 1.3.4 1.4 1.9.2 4.2-.5 6-2.3 1.8-1.8 2.5-4.2 2.3-6-.1-.7-.9-.9-1.4-.4Z" fill="currentColor"/>
      <path d="M10 10.5l4-4M11 12l4-4M12.5 13l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

/* ───────── Component ───────── */
export default function SourceTab() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const currentSection = sp.get("section") ?? undefined;
  const currentProvider = sp.get("provider") ?? undefined;

  // UI
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Panel position
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const recalc = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const panelW = 300; // slightly narrower
    const margin = 8;
    const top = r.bottom + margin;
    const left = Math.min(Math.max(r.left, margin), window.innerWidth - panelW - margin);
    setCoords({ top, left });
  };

  useEffect(() => {
    if (!open) return;
    recalc();
    const on = () => recalc();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);

    const onDoc = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (btnRef.current?.contains(target)) return;
      setOpen(false); // click outside closes — no full-screen overlay needed
    };

    window.addEventListener("resize", on);
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc, { passive: true });

    return () => {
      window.removeEventListener("resize", on);
      window.removeEventListener("scroll", on);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
    };
  }, [open]);

  // Data
  const [rows, setRows] = useState<ProviderRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!open || rows.length) return;
    (async () => {
      try {
        setLoading(true);
        const r = await fetch("/api/home/providers", { cache: "no-store" });
        const j = await r.json();
        setRows(parseProvidersJson(j));
      } finally {
        setLoading(false);
      }
    })();
  }, [open, rows.length]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => r.provider.toLowerCase().includes(needle));
  }, [rows, q]);

  // Apply selection
  const apply = (provider: string | null) => {
    const params = new URLSearchParams(sp.toString());
    if (provider == null || provider.trim() === "") params.delete("provider");
    else params.set("provider", provider.trim());
    params.delete("sourceId"); // avoid mixing
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
      <li className="flex-1 min-w-[68px]">
        <button
          ref={btnRef}
          type="button"
          onClick={() => {
            if (currentProvider && !open) apply(null);
            else setOpen((o) => !o);
          }}
          className={currentProvider ? activeClass : idleClass}
          aria-expanded={open}
          aria-haspopup="dialog"
        >
          <Filter size={18} aria-hidden="true" />
          <span className="hidden sm:block">Provider</span>
        </button>
      </li>

      {/* Panel only (no full-screen overlay) */}
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            className="fixed z-[101] w-[300px] h-[10vh] sm:max-h-[12vh] md:max-h-[28vh] overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl"
            style={{ top: coords.top, left: coords.left }}
            role="dialog"
            aria-modal="true"
          >
            {/* header */}
            <div className="sticky top-0 bg-white/95 backdrop-blur px-2 py-1.5 border-b">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search providers…"
                className="w-full rounded-md border border-zinc-300 px-2 py-[6px] text-sm"
                autoFocus
              />
            </div>

            {/* scroll area */}
            <ul className="p-1 overflow-y-auto max-h-[calc(100%-42px)] scroll-smooth">
              <li>
                <button
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-[12px] hover:bg-zinc-100 leading-tight"
                  onClick={() => apply(null)}
                >
                  <span className="inline-flex h-[16px] w-[16px] items-center justify-center rounded border border-zinc-300" />
                  <span className="font-medium text-emerald-700">All providers</span>
                </button>
              </li>

              {loading ? (
                <li className="px-2 py-2 text-sm text-zinc-500">Loading…</li>
              ) : filtered.length === 0 ? (
                <li className="px-2 py-2 text-sm text-zinc-500">No matches.</li>
              ) : (
                filtered.map((r) => {
                  const isActive = currentProvider === r.provider;
                  const iconUrl = faviconFromProvider(r.provider);
                  return (
                    <li key={r.provider}>
                      <button
                        className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12px] hover:bg-zinc-100 leading-tight ${
                          isActive ? "bg-emerald-50" : ""
                        }`}
                        onClick={() => apply(r.provider)}
                        title={r.provider}
                      >
                        {iconUrl ? (
                          <img
                            src={iconUrl}
                            alt=""
                            width={16}
                            height={16}
                            loading="lazy"
                            className="shrink-0 rounded-sm"
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                              const sib = e.currentTarget.nextElementSibling as HTMLElement | null;
                              if (sib) sib.style.display = "inline-flex";
                            }}
                          />
                        ) : null}
                        <span
                          className={iconUrl ? "hidden shrink-0 text-zinc-500" : "shrink-0 text-zinc-500"}
                          style={{ display: iconUrl ? "none" : "inline-flex" }}
                        >
                          <FootballIcon />
                        </span>

                        <span className="truncate">{r.provider}</span>
                        <span className="ml-auto shrink-0 flex items-center gap-1">
                          <span className="text-[11px] text-zinc-500">{r.count}</span>
                          {isActive && <Check size={14} className="text-emerald-600" aria-hidden="true" />}
                        </span>
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </div>,
          document.body
        )}
    </>
  );
}
