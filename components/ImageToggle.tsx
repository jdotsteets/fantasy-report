// components/ImageToggle.tsx
"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

export type ImagesMode = "all" | "first" | "hero";
const KEY = "ffa_images_mode";

const RING = "ring-emerald-600";
const RING_HOVER = "ring-emerald-500";
const DOT = "bg-emerald-700";

export default function ImageToggle({ className = "" }: { className?: string }) {
  const [mode, setMode] = useState<ImagesMode>("all");
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);

  const [dims, setDims] = useState({ W: 80, H: 32, THUMB: 28, PAD: 2 });

  useLayoutEffect(() => {
    const read = () => {
      const W = trackRef.current?.offsetWidth ?? 80;
      const H = trackRef.current?.offsetHeight ?? 32;
      const cssThumbW = thumbRef.current ? thumbRef.current.offsetWidth : 28;
      const THUMB = Math.min(H - 4, cssThumbW || 28);
      setDims({ W, H, THUMB, PAD: 2 });
    };
    read();
    const ro = new ResizeObserver(read);
    if (trackRef.current) ro.observe(trackRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    setMode((localStorage.getItem(KEY) as ImagesMode | null) ?? "all");
  }, []);
  useEffect(() => {
    localStorage.setItem(KEY, mode);
    window.dispatchEvent(new CustomEvent<ImagesMode>("ffa:imagesMode", { detail: mode }));
    document.documentElement.dataset.imagesMode = mode;
  }, [mode]);

  const values = useMemo(() => (["all", "first", "hero"] as ImagesMode[]), []);
  const index = values.findIndex((v) => v === mode);

  const { W, THUMB, PAD } = dims;
  const positions = [
    PAD,
    Math.max(PAD, Math.round(W / 2 - THUMB / 2)),
    Math.max(PAD, Math.round(W - THUMB - PAD)),
  ];

  return (
    <div
      ref={trackRef}
      role="radiogroup"
      aria-label="Image display mode"
      className={[
        "group relative isolate h-8 w-20 rounded-full select-none",
        // LIGHTER glossy track
        "bg-[linear-gradient(180deg,#fafafa_0%,#eaeaea_100%)]",
        "dark:bg-[linear-gradient(180deg,#5f5f5f_0%,#4b4b4b_100%)]",
        `ring-1 ${RING} transition-all hover:ring-2 hover:${RING_HOVER} focus-within:ring-2 focus-within:${RING_HOVER}`,
        // softer inset depth
        "shadow-[inset_0_1px_4px_rgba(0,0,0,0.16),0_1px_2px_rgba(0,0,0,0.08)]",
        "backdrop-blur",
        className,
      ].join(" ")}
    >
      {/* inner track border */}
      <div
        aria-hidden
        className={[
          "pointer-events-none absolute inset-[3px] rounded-full",
          `ring-1 ${RING} group-hover:ring-emerald-500`,
          "bg-white/20 dark:bg-white/0",     // ⬅︎ new: lifts the interior a touch
        ].join(" ")}
      />

      {/* circular thumb (above dots) — light gray gradient, no dot */}
      <div
        ref={thumbRef}
        aria-hidden
        className={[
          "absolute z-20 top-[2px] rounded-full will-change-[left,transform]",
          "transition-all duration-200 ease-out active:scale-95",
          "bg-[linear-gradient(180deg,#ffffff_0%,#f1f1f1_100%)]",
          "shadow-[0_2px_5px_rgba(0,0,0,0.18),inset_0_1px_1px_rgba(255,255,255,0.9)]",
          `ring-1 ${RING}`,
        ].join(" ")}
        style={{ left: positions[index], width: THUMB, height: THUMB }}
      />

      {/* hit areas + dots (under thumb so nothing appears on the thumb) */}
      <div className="relative z-10 grid h-full grid-cols-3">
        {values.map((value, i) => {
          const active = i === index;
          const title =
            value === "all" ? "All images" :
            value === "first" ? "First in each section" : "Hero only";
          return (
            <button
              key={value}
              role="radio"
              aria-checked={active}
              title={title}
              onClick={() => setMode(value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                  e.preventDefault();
                  const next = e.key === "ArrowLeft" ? Math.max(0, index - 1) : Math.min(2, index + 1);
                  setMode(values[next]);
                }
              }}
              className="group/btn relative flex items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            >
              <span className="sr-only">{title}</span>
              <span
                aria-hidden
                className={[
                  "h-1.5 w-1.5 rounded-full transition-opacity",
                  DOT,
                  // hide active dot so it never shows over the thumb
                  active ? "opacity-0" : "opacity-70 group-hover/btn:opacity-90",
                ].join(" ")}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
