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
      className="group block overflow-hidden rounded-lg border border-zinc-200 bg-transparent hover:shadow-md transition-shadow"
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

      {/* Black text bar + thin white separator line to image */}
      <div className="border-t border-white/70 bg-black text-white px-3 py-2 sm:py-2.5">
        <h3
          className="line-clamp-2 leading-snug text-white text-[clamp(16px,4.6vw,22px)]"
          title={display}
          style={{ textWrap: "balance" as unknown as undefined }}
        >
          {display}
        </h3>

        {/* Meta row (compact) */}
        <div className="mt-1 flex items-center gap-2 text-[10px] leading-tight text-white/70">
          {iconUrl ? <img src={iconUrl} alt="" className="h-3 w-3 rounded-[2px]" /> : null}
          <span>{source}</span>
        </div>
      </div>
    </Link>
  );
}
