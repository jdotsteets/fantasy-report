// components/ArticleList.tsx
"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Article } from "@/types/sources";
import { getSafeImageUrl, FALLBACK, isLikelyFavicon } from "@/lib/images";


type Props = { items: Article[]; title?: string; className?: string };
type ImagesMode = "all" | "first" | "hero";
const MODE_KEY = "ffa_images_mode";

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString();
}


export default function ArticleList({ items, title, className }: Props) {
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

  return (
    <section
      className={[
        "rounded-xl border border-zinc-200 bg-white",
        className,
      ].filter(Boolean).join(" ")}
    >
      {title ? (
        <header className="border-b border-zinc-200 px-3 py-2 sm:px-5 sm:py-2">
          <h2 className="text-base font-semibold sm:text-lg">{title}</h2>
        </header>
      ) : null}

      {/* lighter rule, no extra spacing */}
      <ul className="divide-y divide-zinc-100">
        {items.map((r, idx) => {
          const href = r.canonical_url ?? r.url;

          let candidate = getSafeImageUrl(r.image_url);
          if (!candidate || candidate === FALLBACK || isLikelyFavicon(candidate)) {
            candidate = null;
          }

          const wantImage = mode === "all" ? true : mode === "first" ? idx === 0 : false;
          const displaySrc = candidate && wantImage ? candidate : "";

          return (
            // ↓ tighter vertical padding
            <li key={r.id} className="px-3 py-1.5 sm:px-5 sm:py-2">
              {displaySrc ? (
                <div
                  className="
                    relative mb-1 aspect-[16/8] w-full overflow-hidden rounded-lg bg-zinc-100
                    sm:mb-1.5 sm:aspect-[16/9]
                  "
                >
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
                {/* ↓ remove extra top margin + a touch tighter leading */}
                <h3
                  className="mt-0 text-[13px] leading-tight tracking-tight text-black hover:text-green-900 sm:text-[14px]"
                  title={r.title}
                >
                  {r.title}
                </h3>

                {/* ↓ remove extra top margin, slightly smaller meta */}
                <div className="mt-0 flex flex-wrap items-center gap-x-2 text-[10px] leading-tight text-zinc-700">
                  <span>{fmtDate(r.published_at)}</span>
                  <span>• {r.source}</span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
