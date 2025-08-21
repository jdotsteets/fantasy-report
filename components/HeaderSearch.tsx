// components/HeaderSearch.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function HeaderSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function submit() {
    const term = q.trim();
    if (!term) return;
    router.push(`/search?q=${encodeURIComponent(term)}`);
    setOpen(false);
  }

  return (
    <div className="relative flex items-center gap-2">
      {/* Expandable input */}
      <input
        ref={inputRef}
        type="search"
        placeholder="Search players…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        className={[
          "transition-all duration-200 ease-out",
          "h-9 rounded-md border border-zinc-300 bg-white px-3 text-sm",
          "shadow-sm outline-none focus:border-emerald-500",
          open ? "w-64 opacity-100" : "w-0 opacity-0 pointer-events-none p-0 border-transparent"
        ].join(" ")}
        aria-label="Search"
      />

      {/* Toggle / Submit button */}
      <button
        type="button"
        onClick={() => (open ? submit() : setOpen(true))}
        className={[
          "inline-flex items-center justify-center",
          "h-9 rounded-md px-3 text-sm font-medium",
          "bg-emerald-700 text-white hover:bg-emerald-800",
          "shadow-sm"
        ].join(" ")}
        aria-label={open ? "Search" : "Open search"}
      >
        {open ? "Go" : "Search"}
      </button>

      {/* Close X when open */}
      {open && (
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="absolute -right-8 inline-flex h-6 w-6 items-center justify-center rounded-full text-zinc-500 hover:text-zinc-700"
          aria-label="Close search"
          title="Close"
        >
          ×
        </button>
      )}
    </div>
  );
}
