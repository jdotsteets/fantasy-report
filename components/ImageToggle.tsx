// components/ImageToggle.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

export type ImagesMode = "all" | "first" | "hero";
const KEY = "ffa_images_mode";

export default function ImageToggle({ className = "" }: { className?: string }) {
  const [mode, setMode] = useState<ImagesMode>("all");

  // Load saved mode once
  useEffect(() => {
    setMode((localStorage.getItem(KEY) as ImagesMode | null) ?? "all");
  }, []);

  // Persist + broadcast mode changes
  useEffect(() => {
    localStorage.setItem(KEY, mode);
    window.dispatchEvent(new CustomEvent<ImagesMode>("ffa:imagesMode", { detail: mode }));
    document.documentElement.dataset.imagesMode = mode;
  }, [mode]);

  const values = useMemo(() => (["all", "first", "hero"] as ImagesMode[]), []);

  const labels: Record<ImagesMode, string> = {
    all: "Images",
    first: "Lead Image",
    hero: "Headlines",
  };

  return (
    <div
      role="radiogroup"
      aria-label="Display density"
      className={[
        "flex items-center gap-1 rounded-full border border-white/15 bg-white/5 p-1 text-[11px] font-semibold text-white",
        "shadow-[0_8px_24px_rgba(0,0,0,0.35)] backdrop-blur",
        className,
      ].join(" ")}
    >
      {values.map((value) => {
        const active = value === mode;
        return (
          <button
            key={value}
            role="radio"
            aria-checked={active}
            title={labels[value]}
            onClick={() => setMode(value)}
            className={[
              "rounded-full px-2.5 py-1 transition",
              active ? "bg-white text-black shadow" : "text-white/70 hover:text-white",
            ].join(" ")}
          >
            {labels[value]}
          </button>
        );
      })}
    </div>
  );
}
