// components/ImageToggle.tsx
"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

export type ImagesMode = "all" | "first" | "hero";
const KEY = "ffa_images_mode";

/** ==== COLOR CONTROLS =======================================================
 *  - RING / RING_HOVER: Tailwind ring-* classes used for the outer borders.
 *  - DOT: Tailwind bg-* class used for the dot color (the two small dots).
 *  - Track gradient colors: see the bg-[linear-gradient(...)] strings below.
 *  - Thumb gradient colors: see the bg-[linear-gradient(...)] on the thumb.
 *  - Inner-track fill in light/dark mode: "bg-white/20 dark:bg-white/0".
 * ============================================================================
 */
const RING = "ring-emerald-900";
const RING_HOVER = "ring-emerald-600";
const DOT = "bg-emerald-700";

export default function ImageToggle({ className = "" }: { className?: string }) {
  const [mode, setMode] = useState<ImagesMode>("all");

  // Refs so we can read live sizes from the DOM
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);

  /** ==== SIZE CONTROLS ======================================================
   *  - W, H: initial width/height of the whole switch (in px). These are
   *          *fallbacks* — real values are read from the element on mount.
   *  - THUMB: fallback thumb diameter (auto-clamped to track height).
   *  - PAD: horizontal padding inside the track (left/right).
   *  NOTE: The track’s *Tailwind* sizes are set via "h-8 w-20" in the class
   *        list below. Change those to scale the switch (e.g., h-7 w-16).
   * ==========================================================================
   */
  const [dims, setDims] = useState({ W: 56, H: 24, THUMB: 20, PAD: 2 }); // (was 80/32)

  // Read actual rendered sizes so the thumb position stays perfect at any width.
  useLayoutEffect(() => {
    const read = () => {
      const W = trackRef.current?.offsetWidth ?? 80;
      const H = trackRef.current?.offsetHeight ?? 32;

      // If the CSS changes the thumb width via utilities, use it; otherwise fall back.
      const cssThumbW = thumbRef.current ? thumbRef.current.offsetWidth : 28;

      // Keep the thumb slightly smaller than the track height.
      const THUMB = Math.min(H - 4, cssThumbW || 28);

      setDims({ W, H, THUMB, PAD: 2 });
    };

    read();
    const ro = new ResizeObserver(read);
    if (trackRef.current) ro.observe(trackRef.current);
    return () => ro.disconnect();
  }, []);

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
        // ==== TRACK SIZE (Tailwind) =========================================
        // Change these to scale the whole switch:
        "group relative isolate h-4 w-10 rounded-full select-none",

        // ==== TRACK BACKGROUND COLORS =======================================
        // Light mode glossy gradient:
        "bg-[linear-gradient(180deg,#fafafa_0%,#eaeaea_100%)]",
        // Dark mode glossy gradient:
       // "dark:bg-[linear-gradient(180deg,#5f5f5f_0%,#4b4b4b_100%)]",

        // ==== OUTER RING COLORS / HOVER =====================================
        // Uses RING and RING_HOVER constants defined at the top:
        `ring-1 ${RING} transition-all hover:ring-2 hover:${RING_HOVER} focus-within:ring-2 focus-within:${RING_HOVER}`,

        // ==== DEPTH / SHADOWS ===============================================
        "shadow-[inset_0_1px_4px_rgba(0,0,0,0.16),0_1px_2px_rgba(0,0,0,0.08)]",
        "backdrop-blur",

        className,
      ].join(" ")}
    >
      {/* Inner track border and subtle fill (light: white/20, dark: transparent) */}
      <div
        aria-hidden
        className={[
          "pointer-events-none absolute inset-[3px] rounded-full",
          `ring-1 ${RING} group-hover:ring-emerald-500`,
          "bg-white/20 dark:bg-white/0", // <-- lighten/darken the interior here
        ].join(" ")}
      />

      {/* ==== THUMB ===========================================================
          - Position set via inline style `left: positions[index]`.
          - Thumb SIZE comes from inline style width/height (derived from track).
          - Thumb COLORS: gradient below + ring color from RING.
       */}
      <div
        ref={thumbRef}
        aria-hidden
        className={[
          "absolute z-20 top-[2px] rounded-full will-change-[left,transform]",
          "transition-all duration-200 ease-out active:scale-95",
          // Thumb gradient (light gray):
          "bg-[linear-gradient(180deg,#ffffff_0%,#f1f1f1_100%)]",
          "shadow-[0_2px_5px_rgba(0,0,0,0.18),inset_0_1px_1px_rgba(255,255,255,0.9)]",
          `ring-1 ${RING}`,
        ].join(" ")}
        style={{ left: positions[index], width: THUMB, height: THUMB }}
      />

      {/* Click/keyboard hit areas + the two dots (beneath the thumb) */}
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
                  const next =
                    e.key === "ArrowLeft" ? Math.max(0, index - 1) : Math.min(2, index + 1);
                  setMode(values[next]);
                }
              }}
              className="group/btn relative flex items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            >
              <span className="sr-only">{title}</span>

              {/* ==== DOT SIZE & COLOR =======================================
                  - Size: "h-1.5 w-1.5"
                  - Color: DOT constant (bg-emerald-900)
                  - Visibility: active option hides the dot so it never peeks
                    through the moving thumb.
               */}
              <span
                aria-hidden
                className={[
                  "h-1 w-1 rounded-full transition-opacity",
                  DOT,
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
