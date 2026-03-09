"use client";

import Image from "next/image";
import Link from "next/link";
import type { Article } from "@/types/sources";
import { getSafeImageUrl, FALLBACK, isLikelyFavicon, isLikelyAuthorHeadshot } from "@/lib/images";
import { normalizeTitle } from "@/lib/strings";

export default function BetaHero({ article }: { article: Article }) {
  const href = article.canonical_url ?? article.url;
  const title = normalizeTitle(article.title || "");
  const domain = article.domain ?? (() => {
    try {
      return new URL(href).hostname.replace(/^www\./, "");
    } catch {
      return null;
    }
  })();
  const favicon = domain ? `https://icons.duckduckgo.com/ip3/${domain}.ico` : null;

  let image = getSafeImageUrl(article.image_url);
  if (!image || image === FALLBACK || isLikelyFavicon(image) || isLikelyAuthorHeadshot(image)) {
    image = null;
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-zinc-200 bg-black text-white shadow-lg">
      <div className="grid gap-0 md:grid-cols-[1.2fr_1fr]">
        <div className="relative min-h-[220px] md:min-h-[360px]">
          {image ? (
            <Image
              src={image}
              alt=""
              fill
              priority
              sizes="(max-width: 768px) 100vw, 60vw"
              className="object-cover"
              referrerPolicy="no-referrer"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-700 via-zinc-900 to-black" />
          )}
        </div>
        <div className="flex flex-col justify-between gap-6 p-6 md:p-8">
          <div className="space-y-3">
            <p className="text-xs uppercase tracking-[0.3em] text-emerald-300">Top story</p>
            <Link href={href} target="_blank" rel="noreferrer">
              <h1 className="text-2xl font-semibold leading-snug md:text-3xl">
                {title}
              </h1>
            </Link>
            <p className="text-sm text-zinc-200">
              {article.summary && article.summary.trim().length > 0
                ? article.summary
                : "Premium curation of the most important fantasy football updates, with direct paths to the source."}
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-zinc-300">
            {favicon ? (
              <Image
                src={favicon}
                alt=""
                width={18}
                height={18}
                unoptimized
                className="h-4 w-4 rounded"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <span className="h-4 w-4 rounded bg-white/20" />
            )}
            <span>{article.source ?? domain}</span>
            <span>•</span>
            <span>{article.published_at ? new Date(article.published_at).toLocaleString() : ""}</span>
            <Link
              href={href}
              target="_blank"
              rel="noreferrer"
              className="ml-auto rounded-full border border-emerald-400 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-200"
            >
              Read the source →
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
