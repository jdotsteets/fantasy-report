// components/ArticleList.tsx
"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Article, TopicKey } from "@/types/sources";
import {
  getSafeImageUrl,
  FALLBACK,
  isLikelyFavicon,
  isLikelyAuthorHeadshot,
} from "@/lib/images";
import { normalizeTitle } from "@/lib/strings";

type ImagesMode = "all" | "first" | "hero";
const MODE_KEY = "ffa_images_mode";

// include "advice"
type SectionKey = "waivers" | "rankings" | "start-sit" | "injury" | "dfs" | "news" | "advice";
type Filter = { section?: SectionKey; source?: string };

type Props = {
  items: Article[];
  title?: string;
  className?: string;
  filter?: Filter;
};

const SECTION_TO_TOPIC: Record<SectionKey, string> = {
  waivers: "waiver-wire",
  rankings: "rankings",
  "start-sit": "start-sit",
  injury: "injury",
  dfs: "dfs",
  news: "news",
  advice: "advice",
};

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString();
}

/* ───────────────────────── Relevance Logic ───────────────────────── */

function heuristicMatch(section: SectionKey, a: Article): boolean {
  const title = normalizeTitle(a.title || "").toLowerCase();
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
      return true; // broad; rely on recency
    case "advice":
      return has(/\badvice\b|\bhelp\b|\btips?\b|\bstrategy\b|\bguide\b/);
  }
}

/** 2 = primary_topic; 1 = secondary/topics/heuristic; 0 = none */
function sectionRelevance(a: Article, section?: SectionKey): 0 | 1 | 2 {
  if (!section) return 2;

  const topic = SECTION_TO_TOPIC[section];

  const primary: string | null = a.primary_topic ?? null;
  const secondary: string | null = a.secondary_topic ?? null;

  // normalize topics to a readonly string[]
  const topics: readonly string[] = Array.isArray(a.topics)
    ? (a.topics.filter((t): t is string => typeof t === "string") as readonly string[])
    : [];

  if (primary === topic) return 2;
  if (secondary === topic) return 1;
  if (topics.includes(topic)) return 1;
  if (heuristicMatch(section, a)) return 1;

  return 0;
}

/** Score → filter (>0) → sort (score desc, then recency) */
function selectForSection(articles: Article[], section: SectionKey | undefined): Article[] {
  const scored = articles
    .map((a) => ({ a, score: sectionRelevance(a, section) }))
    .filter((x) => x.score > 0)
    .sort((x, y) => {
      if (y.score !== x.score) return y.score - x.score;
      const ad = x.a.published_at ? Date.parse(x.a.published_at) : 0;
      const bd = y.a.published_at ? Date.parse(y.a.published_at) : 0;
      return bd - ad;
    })
    .map((x) => x.a);

  return scored;
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

  const filtered = useMemo(() => {
    let out = items;

    if (filter?.source) {
      const s = filter.source.toLowerCase();
      out = out.filter((a) => (a.source ?? "").toLowerCase() === s);
    }

    if (filter?.section) {
      out = selectForSection(out, filter.section);
    } else {
      out = [...out].sort((a, b) => {
        const ad = a.published_at ? Date.parse(a.published_at) : 0;
        const bd = b.published_at ? Date.parse(b.published_at) : 0;
        return bd - ad;
      });
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
            if (
              !candidate ||
              candidate === FALLBACK ||
              isLikelyFavicon(candidate) ||
              isLikelyAuthorHeadshot(candidate)
            ) {
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
                        className="h-[18px] w-[18px] shrink-0 -translate-y-0.5"
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
