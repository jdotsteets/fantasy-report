// components/Hero.tsx
"use client";

import Image from "next/image";
import Link from "next/link";
import { getSafeImageUrl, FALLBACK } from "@/lib/images";
import { normalizeTitle } from "@/lib/strings";

export type HeroProps = {
  title: string;
  href: string;
  src?: string;
  source: string;
};

export default function Hero({ title, href, src, source }: HeroProps) {
  const img = getSafeImageUrl(src) || FALLBACK;
  const display = normalizeTitle(title);

  const iconUrl = (() => {
    try {
      const host = new URL(href).hostname.replace(/^www\./, "");
      return `https://icons.duckduckgo.com/ip3/${host}.ico`;
    } catch {
      return null;
    }
  })();

  return (
    <Link
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="group block overflow-hidden rounded-lg border border-zinc-200 bg-white hover:shadow-md transition-shadow"
    >
      <div className="relative aspect-[16/9] w-full">
        <Image
          src={img}
          alt={title || ""}
          fill
          priority
          quality={85}
          sizes="(max-width: 768px) 100vw, 768px"
          className="object-cover"
          referrerPolicy="no-referrer"
          onError={(e) => {
            const el = e.currentTarget as HTMLImageElement;
            if (el.src !== FALLBACK) el.src = FALLBACK;
          }}
        />
      </div>

      {/* Headline row with favicon */}
      <div className="mt-2 mx-2 flex items-start gap-2">


        <h3
          className="line-clamp-2 text-black hover:text-green-900 leading-snug
                     text-[clamp(16px,4.6vw,22px)]"
          title={display}
          style={{ textWrap: "balance" as any }}
        >
          {display}
        </h3>
      </div>

      {/* Meta row */}
      <div className="mt-1 mb-2 ml-2.5 flex flex-wrap items-center gap-x-6 text-[10px] leading-tight text-zinc-700">
        <span>{source}</span>
      </div>
    </Link>
  );
}
