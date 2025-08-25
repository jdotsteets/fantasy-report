// components/ImageToggle.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * The three display modes your site supports:
 *  - "all":   show all images in lists
 *  - "first": show an image only for the first item in each section
 *  - "hero":  show just headlines (no list images), hero may still appear
 */
export type ImagesMode = "all" | "first" | "hero";

/** LocalStorage key used to persist the user's choice across page loads. */
const KEY = "ffa_images_mode";

/**
 * 🎛️ DESIGN TOKENS
 * Tweak these first whenever you want to restyle the control.
 *
 * COLORS
 *  - BORDER:      used for the outer border, focus ring, and the vertical dividers.
 *  - ACTIVE_BG:   subtle background tint behind the currently selected segment.
 *  - ICON:        stroke/fill color of the three mini “layout” icons.
 *
 * SIZES
 *  - RADIUS:          Tailwind corner radius class for the **whole** control.
 *  - GAP_X / GAP_Y:   inner padding **inside each segment** (controls icon spacing).
 *  - TRACK_W/H:       reference dimensions for ergonomics; not strictly required,
 *                     but a good target for header layout space.
 *  - ICON_W/H:        width/height of the little preview icons.
 *  - DIVIDER_INSET:   how far the vertical divider pulls back from the top/bottom.
 *
 * ⚠️ Tailwind note:
 * If you use dynamic classes like `border-${COLORS.BORDER}`, make sure those color
 * utilities are present or safelisted in your Tailwind config so they are not purged.
 */
const TOKENS = {
  COLORS: {
    BORDER: "emerald-600",   // outer border, divider, focus ring
    ACTIVE_BG: "emerald-600/10", // active segment tint
    ICON: "emerald-700",     // mini-icon stroke/fill
  },
  SIZES: {
    RADIUS: "rounded-lg",    // outer corner radius of the pill container
    GAP_X: "px-1.5 sm:px-2", // horizontal padding per button (affects spacing between icons)
    GAP_Y: "py-1",         // vertical padding per button (affects control height)
    TRACK_W: 216,            // reference; not directly used in layout calculations here
    TRACK_H: 40,             // reference; pairs well with ICON_H = 24
    ICON_W: 28,              // width of each mini layout icon
    ICON_H: 28,              // height of each mini layout icon
    DIVIDER_INSET: 5,        // top/bottom margin for the vertical divider (px)
  },
};

/* -------------------------------------------------------------------------- */
/*                              MINI LAYOUT ICONS                             */
/*   Each icon is an inline SVG. All geometry below is *internal* measuring   */
/*   relative to ICON_W/ICON_H so you can change sizes from TOKENS.           */
/*   Colors: each SVG uses `currentColor`, which comes from the wrapper class */
/*   `text-${TOKENS.COLORS.ICON}`.                                            */
/* -------------------------------------------------------------------------- */

/** FULL view icon: two mini cards with full-width images and short headlines. */
function IconAll() {
  const { ICON_W, ICON_H } = TOKENS.SIZES;

  // Geometry inside the icon (tweak to change the “look” of the miniature)
  const m = 3.0;      // inner margin around the content box
  const imgH = 8.0;   // height of each mini “image” rectangle
  const gap = 2;    // vertical gap between image and headline lines
  const iw = ICON_W - m * 2.5; // inner width available for content

  const line = (y: number, wScale = 1) => (
    <line x1={m} y1={y} x2={m + iw * wScale} y2={y} />
  );

  return (
    <svg
      width={ICON_W}
      height={ICON_H}
      viewBox={`0 0 ${ICON_W} ${ICON_H}`}
      // The icon color is controlled here via Tailwind text-*
      className={`text-${TOKENS.COLORS.ICON}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
    >
      {/* outer mini-card frame (visual hint only) */}
      <rect x="0.6" y="0.6" width={ICON_W - 1.2} height={ICON_H - 1.2} rx="3.2" />

      {/* Card 1 */}
      <rect x={m} y={m} width={iw} height={imgH} rx="1.1" fill="currentColor" />
      {line(m + imgH + gap, 0.96)}
      {line(m + imgH + gap * 2, 0.8)}

      {/* Card 2 */}
      <rect x={m} y={m + imgH + gap * 3.4} width={iw} height={imgH} rx="1.1" fill="currentColor" />
      {line(m + imgH * 2 + gap * 4.6, 0.96)}
      {line(m + imgH * 2 + gap * 5.6, 0.8)}
    </svg>
  );
}

/** LIMITED view icon: one mini card with a full-width image and several lines. */
function IconFirst() {
  const { ICON_W, ICON_H } = TOKENS.SIZES;

  // Internal geometry
  const m = 3.0;     // inner margin
  const imgH = 5.4;  // image height
  const gap = 1.4;   // spacing between text lines
  const iw = ICON_W - m * 2;

  const line = (y: number, wScale = 1) => (
    <line x1={m} y1={y} x2={m + iw * wScale} y2={y} />
  );

  const startY = m + imgH + gap;

  return (
    <svg
      width={ICON_W}
      height={ICON_H}
      viewBox={`0 0 ${ICON_W} ${ICON_H}`}
      className={`text-${TOKENS.COLORS.ICON}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
    >
      <rect x="0.6" y="0.6" width={ICON_W - 1.2} height={ICON_H - 1.2} rx="3.2" />
      <rect x={m} y={m} width={iw} height={imgH} rx="1.1" fill="currentColor" />
      {Array.from({ length: 5 }).map((_, i) =>
        line(startY + i * gap, i % 2 ? 0.88 : 1) // alternating shorter lines for visual rhythm
      )}
    </svg>
  );
}

/** COMPACT view icon: headlines only (a simple stack of lines). */
function IconHeroOnly() {
  const { ICON_W, ICON_H } = TOKENS.SIZES;

  // Internal geometry
  const m = 3.0;     // inner margin
  const gap = 1.4;   // spacing between headline lines
  const iw = ICON_W - m * 2;

  const line = (y: number, wScale = 1) => (
    <line x1={m} y1={y} x2={m + iw * wScale} y2={y} />
  );

  const startY = m + 1.2; // small inset from top

  return (
    <svg
      width={ICON_W}
      height={ICON_H}
      viewBox={`0 0 ${ICON_W} ${ICON_H}`}
      className={`text-${TOKENS.COLORS.ICON}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
    >
      <rect x="0.6" y="0.6" width={ICON_W - 1.2} height={ICON_H - 1.2} rx="3.2" />
      {Array.from({ length: 6 }).map((_, i) =>
        line(startY + i * gap, i % 2 ? 0.9 : 1)
      )}
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/*                               TOGGLE WRAPPER                               */
/* -------------------------------------------------------------------------- */

export default function ImageToggle({ className = "" }: { className?: string }) {
  const [mode, setMode] = useState<ImagesMode>("all");

  // Button options: order determines keyboard left/right cycling.
  const options = useMemo(
    () =>
      [
        { key: "all", label: "All images", Icon: IconAll },
        { key: "first", label: "First in each section", Icon: IconFirst },
        { key: "hero", label: "Headlines only", Icon: IconHeroOnly },
      ] as const,
    []
  );

  // Initialize from localStorage on mount.
  useEffect(() => {
    setMode((localStorage.getItem(KEY) as ImagesMode | null) ?? "all");
  }, []);

  // Persist to localStorage, broadcast to other components,
  // and reflect on <html data-images-mode="..."> for CSS hooks if needed.
  useEffect(() => {
    localStorage.setItem(KEY, mode);
    window.dispatchEvent(new CustomEvent<ImagesMode>("ffa:imagesMode", { detail: mode }));
    document.documentElement.dataset.imagesMode = mode;
  }, [mode]);

  return (
    <div
      role="radiogroup"
      aria-label="Image display mode"
      className={[
        // Layout: horizontal pill of three segments
        "inline-flex items-stretch overflow-hidden backdrop-blur",
        TOKENS.SIZES.RADIUS,                          // ⬅️ outer corner radius
        `border border-${TOKENS.COLORS.BORDER}`,      // ⬅️ outer border color
        "bg-white/70 dark:bg-white/10 shadow-sm",     // background + soft shadow
        className,
      ].join(" ")}
    >
      {options.map(({ key, label, Icon }, i) => {
        const active = mode === key;

        return (
          <div key={key} className="relative flex">
            <button
              type="button"
              role="radio"
              aria-checked={active}
              title={label}
              onClick={() => setMode(key)}
              onKeyDown={(e) => {
                // Keyboard accessibility: Left/Right arrow cycles between segments.
                if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                  e.preventDefault();
                  const dir = e.key === "ArrowLeft" ? -1 : 1;
                  const idx = options.findIndex((o) => o.key === mode);
                  const next = (idx + dir + options.length) % options.length;
                  setMode(options[next].key);
                }
              }}
              className={[
                "relative isolate outline-none select-none",
                TOKENS.SIZES.GAP_X,                     // ⬅️ horizontal padding inside the segment
                TOKENS.SIZES.GAP_Y,                     // ⬅️ vertical padding inside the segment
                `focus-visible:ring-2 focus-visible:ring-${TOKENS.COLORS.BORDER}`, // ⬅️ focus ring color
                active
                  ? `bg-${TOKENS.COLORS.ACTIVE_BG}`     // ⬅️ active background tint
                  : "hover:bg-black/[0.04] dark:hover:bg-white/10", // hover feedback
                // Icon color is applied inside each Icon via `text-${TOKENS.COLORS.ICON}`
              ].join(" ")}
            >
              <span className="sr-only">{label}</span>
              <Icon />
            </button>

            {/* Short vertical divider between segments.
               - Color uses BORDER at 30% opacity.
               - Height is reduced by DIVIDER_INSET at the top and bottom. */}
            {i < options.length - 1 ? (
              <span
                aria-hidden
                className={[
                  // top/bottom inset (px). Using inline style for precise pixels.
                  `w-px self-stretch bg-${TOKENS.COLORS.BORDER}/30`,
                ].join(" ")}
                style={{ marginTop: TOKENS.SIZES.DIVIDER_INSET, marginBottom: TOKENS.SIZES.DIVIDER_INSET }}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
