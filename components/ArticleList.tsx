"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Article } from "@/types/sources";
import { getSafeImageUrl, FALLBACK, isLikelyFavicon } from "@/lib/images";
import { normalizeTitle } from "@/lib/strings";

type ImagesMode = "all" | "first" | "hero";
const MODE_KEY = "ffa_images_mode";

type SectionKey = "waivers" | "rankings" | "start-sit" | "injury" | "dfs" | "news";
type Filter = { section?: SectionKey; source?: string };

type Props = {
  items: Article[];
  title?: string;
  className?: string;
  filter?: Filter;
};

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString();
}

// Optional section matcher (only applies if filter.section provided)
function matchesSection(a: Article, section?: SectionKey): boolean {
  if (!section) return true;

  const title = (normalizeTitle(a.title) ?? "").toLowerCase();
  const url = (a.canonical_url ?? a.url ?? "").toLowerCase();
  const has = (re: RegExp) => re.test(title) || re.test(url);

  switch (section) {
    case "waivers":
      return has(/\bwaiver(?:s)?\b/);
    case "rankings":
      return has(/\branking(?:s)?\b|\btiers?\b|\btop\s?\d+\b|\bqb1\b|\brb1\b|\bwr1\b/);
    case "start-sit":
      return has(/\bstart[\s/-]?sit\b|\bwho to (start|sit)\b|\bsleeper(?:s)?\b/);
    case "injury":
      return has(/\binjur(?:y|ies)\b|\bquestionable\b|\b(dnp|out|doubtful)\b|\bpractice report\b|\bstatus report\b/);
    case "dfs":
      return has(/\bdfs\b|\bdraftkings\b|\bfanduel\b|\bgpp\b|\bcash games?\b|\b(lineup|stack)s?\b/);
    case "news":
      return true;
  }
}

/** Typography */
const HEADLINE_TEXT_CLS =
  "mt-0 text-[12px] sm:text-[13px] leading-snug tracking-tight text-black hover:text-green-900";
const SUBHEADLINE_TEXT_CLS =
  "mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] sm:text-[11px] leading-tight text-zinc-700";

export default function ArticleList({ items, title, className, filter }: Props) {
  const [mode, setMode] = useState<ImagesMode>("all");

  useEffect(() => {
    try {
      setMode((localStorage.getItem(MODE_KEY) as ImagesMode | null) ?? "all");
    } catch {
      /* no-op */
    }
    const onChange = (e: Event) => setMode((e as CustomEvent<ImagesMode>).detail);
    window.addEventListener("ffa:imagesMode", onChange as EventListener);
    return () => window.removeEventListener("ffa:imagesMode", onChange as EventListener);
  }, []);

  // Apply optional filters; if you don't pass filter.section/source, nothing is filtered here.
  const filtered = useMemo(() => {
    let out = items;
    if (filter?.section) out = out.filter((a) => matchesSection(a, filter.section));
    if (filter?.source) {
      const s = filter.source.toLowerCase();
      out = out.filter((a) => (a.source ?? "").toLowerCase() === s);
    }
    return out;
  }, [items, filter?.section, filter?.source]);

  const isEmpty = filtered.length === 0;

  return (
    <section className={["rounded-xl bg-white", className].filter(Boolean).join(" ")}>
      {title ? (
        <header className="px-3 py-2 sm:px-5 sm:py-2">
          <h2 className="text-base font-semibold sm:text-lg">{title}</h2>
        </header>
      ) : null}

      {isEmpty ? (
        <div className="px-3 py-6 sm:px-5 text-sm text-zinc-500">No items to show.</div>
      ) : (
        <ul className="divide-y divide-zinc-300">
          {filtered.map((r, idx) => {
            const href = r.canonical_url ?? r.url;
            const displayTitle = normalizeTitle(r.title || "");

            // Image handling
            let candidate = getSafeImageUrl(r.image_url);
            if (!candidate || candidate === FALLBACK || isLikelyFavicon(candidate)) {
              candidate = null;
            }
            const wantImage = mode === "all" ? true : mode === "first" ? idx === 0 : false;
            const displaySrc = candidate && wantImage ? candidate : "";

            // Favicon from domain
            const favicon = r.domain ? `https://icons.duckduckgo.com/ip3/${r.domain}.ico` : null;

            return (
              <li key={r.id} className="px-1 py-3 sm:px-2 sm:py-2">
                {/* Optional preview image */}
                {displaySrc ? (
                  <div className="relative mb-1 aspect-[16/8] w-full overflow-hidden rounded-lg bg-zinc-100 sm:mb-1.5 sm:aspect-[16/9]">
                    <Image
                      src={displaySrc}
                      alt=""
                      fill
                      sizes="(max-width: 640px) 100vw, 50vw"
                      className="object-cover"
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = "none";
                      }}
                    />
                  </div>
                ) : null}

                {/* Two-column row: favicon | (title + meta) */}
                <Link href={href} target="_blank" rel="noreferrer" className="block no-underline">
<div className="flex items-center gap-2">
  {favicon ? (
        <Image
          src={favicon}
          alt=""
          width={18}
          height={18}
          unoptimized
          className="h-[18px] w-[18px] shrink-0 rounded -translate-y-0.5"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
  ) : (
    <span className="h-[18px] w-[18px] shrink-0 rounded bg-zinc-200 -translate-y-0.5" />
  )}
  <div className="min-w-0 flex-1">
    <h3 className={HEADLINE_TEXT_CLS} title={displayTitle}>
      {displayTitle}
    </h3>
    <div className={SUBHEADLINE_TEXT_CLS}>
      <span>{fmtDate(r.published_at)}</span>
      <span>• {r.source}</span>
    </div>
  </div>
</div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
