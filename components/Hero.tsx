// components/Hero.tsx
"use client";

import Image from "next/image";
import Link from "next/link";
import { getSafeImageUrl, FALLBACK } from "@/lib/images";

export type HeroProps = {
  title: string;
  href: string;
  src?: string;
  source: string;
};




export default function Hero({ title, href, src, source }: HeroProps) {
  const img = getSafeImageUrl(src) || FALLBACK;


    console.log("Hero image check:", { src, safeValue: img });

  return (
    <Link
      href={href}
      target="_blank"
      rel="noreferrer"
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

                {/* Headline */}
                <h3
                className="mt-2 ml-2 line-clamp-2 text-[20px] leading-snug text-black hover:text-green-900"
                title={title}
                >
                {title}
                </h3>

                {/* Meta row */}
                <div className="mt-1 mb-2 ml-2.5 flex flex-wrap items-center gap-x-6 text-[10px] leading-tight text-zinc-700" >
                  <span>{source}</span>
                </div>
    </Link>
  );
}
