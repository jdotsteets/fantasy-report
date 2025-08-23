//components/ArticleLink.tsx
"use client";

import Image from "next/image";
import Link from "next/link";
import type { Article } from "@/types/sources";
import { getSafeImageUrl, FALLBACK } from "@/lib/images";

type ArticleLinkProps = {
  article: Article;
  className?: string;
};

export default function ArticleLink({ article: a, className }: ArticleLinkProps) {
  const href = a.canonical_url ?? a.url;
  const img = getSafeImageUrl(a.image_url);

  return (
    <li
      className={[
        "rounded-lg border p-3 hover:shadow-sm transition",
        className,
      ].filter(Boolean).join(" ")}
    >
      {img ? (
        <div className="relative mb-3 aspect-[16/9] w-full overflow-hidden rounded-md bg-zinc-100">
          <Image
            src={img}
            alt={a.title || ""}
            fill
            sizes="(max-width: 768px) 100vw, 50vw"
            className="object-cover"
            unoptimized
            referrerPolicy="no-referrer"
            onError={(e) => {
              const el = e.currentTarget as HTMLImageElement;
              if (el.src !== FALLBACK) el.src = FALLBACK;
            }}
          />
        </div>
      ) : null}

      <Link href={href} target="_blank" rel="noreferrer" className="block">
        <div className="text-xs text-zinc-500">
          {a.source}
          {a.domain ? ` · ${a.domain}` : ""}
        </div>
        <h3 className="mt-1 line-clamp-2 font-medium text-zinc-900">
          {a.title}
        </h3>
      </Link>
    </li>
  );
}
