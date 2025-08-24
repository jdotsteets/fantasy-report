// components/ArticleList.tsx
"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Article } from "@/types/sources";
import { getSafeImageUrl, FALLBACK, isLikelyFavicon } from "@/lib/images";

type ImagesMode = "all" | "first" | "hero";
const MODE_KEY = "ffa_images_mode";

type Filter = {
  section?:
    | "waivers"
    | "rankings"
    | "start-sit"
    | "injury"
    | "dfs"
    | "news";
  source?: string; // optional publisher clamp
};

type Props = {
  items: Article[];
  title?: string;
  className?: string;
  filter?: Filter; // ✅ NEW
};

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString();
}

/** Heuristic matcher in case articles don't have a dedicated section field yet. */
function matchesSection(a: Article, section: NonNullable<Filter>["section"]): boolean { // ✅ return type
  if (!section) return true;

  const t = (a.title || "").toLowerCase();
  const u = (a.url || (a as any).canonical_url || "").toLowerCase();

  const contains = (arr: string[]) => arr.some((k) => t.includes(k) || u.includes(k));

  switch (section) {
    case "waivers":
      return contains(["waiver", "waivers", "wire", "pickup", "adds"]);
    case "rankings":
      return contains(["ranking", "rankings", "tiers", "tier list", "top 100", "qb1", "rb1", "wr1"]);
    case "start-sit":
      return contains(["start/sit", "start-sit", "start or sit", "who to start", "who to sit"]);
    case "injury":
      return contains(["injury", "injuries", "questionable", "out", "status report", "practice report"]);
    case "dfs":
      return contains(["dfs", "draftkings", "fanduel", "gpp", "cash games", "lineup", "stack"]);
    case "news":
      // If none of the above matched, treat as general news
      return !(
        matchesSection(a, "waivers") ||
        matchesSection(a, "rankings") ||
        matchesSection(a, "start-sit") ||
        matchesSection(a, "injury") ||
        matchesSection(a, "dfs")
      );
    default:
      return true;
  }
}

export default function ArticleList({ items, title, className, filter }: Props) {
  const [mode, setMode] = useState<ImagesMode>("all");

  useEffect(() => {
    try {
      setMode((localStorage.getItem(MODE_KEY) as ImagesMode | null) ?? "all");
    } catch {}
    const onChange = (e: Event) =>
      setMode((e as CustomEvent<ImagesMode>).detail);
    window.addEventListener("ffa:imagesMode", onChange as EventListener);
    return () =>
      window.removeEventListener("ffa:imagesMode", onChange as EventListener);
  }, []);

  // ✅ apply optional filter
  const filtered = useMemo(() => {
    let out = items;
    if (filter?.section) out = out.filter((a) => matchesSection(a, filter.section));
    if (filter?.source) {
      const s = filter.source.toLowerCase();
      out = out.filter((a: any) => (a.source || "").toLowerCase() === s);
    }
    return out;
  }, [items, filter?.section, filter?.source]);

  return (
    <section className={["rounded-xl border border-zinc-200 bg-white", className].filter(Boolean).join(" ")}>
      {title ? (
        <header className="border-b border-zinc-200 px-3 py-2 sm:px-5 sm:py-2">
          <h2 className="text-base font-semibold sm:text-lg">{title}</h2>
        </header>
      ) : null}

      <ul className="divide-y divide-zinc-100">
        {filtered.map((r, idx) => {
          const href = (r as any).canonical_url ?? r.url;

          let candidate = getSafeImageUrl((r as any).image_url);
          if (!candidate || candidate === FALLBACK || isLikelyFavicon(candidate)) {
            candidate = null;
          }

          const wantImage = mode === "all" ? true : mode === "first" ? idx === 0 : false;
          const displaySrc = candidate && wantImage ? candidate : "";

          return (
            <li key={(r as any).id ?? href + idx} className="px-3 py-1.5 sm:px-5 sm:py-2">
              {displaySrc ? (
                <div className="relative mb-1 aspect-[16/8] w-full overflow-hidden rounded-lg bg-zinc-100 sm:mb-1.5 sm:aspect-[16/9]">
                  <Image
                    src={displaySrc}
                    alt=""
                    fill
                    sizes="(max-width: 640px) 100vw, 50vw"
                    className="object-cover"
                    referrerPolicy="no-referrer"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                  />
                </div>
              ) : null}

              <Link href={href} target="_blank" rel="noreferrer" className="block no-underline">
                <h3 className="mt-0 text-[13px] leading-tight tracking-tight text-black hover:text-green-900 sm:text-[14px]" title={r.title}>
                  {r.title}
                </h3>

                <div className="mt-0 flex flex-wrap items-center gap-x-2 text-[10px] leading-tight text-zinc-700">
                  <span>{fmtDate((r as any).published_at)}</span>
                  <span>• {(r as any).source}</span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
