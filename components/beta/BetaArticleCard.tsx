"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Article } from "@/types/sources";
import { getSafeImageUrl, FALLBACK, isLikelyFavicon, isLikelyAuthorHeadshot } from "@/lib/images";
import { normalizeTitle } from "@/lib/strings";
import BetaTopicPills from "@/components/beta/BetaTopicPills";

function displayWhyMatters(article: Article): string | null {
  if (article.summary && article.summary.trim().length > 0) return article.summary.trim();
  return null;
}

function getTopics(article: Article): string[] {
  const topics = new Set<string>();
  if (article.primary_topic) topics.add(article.primary_topic);
  if (article.secondary_topic) topics.add(article.secondary_topic);
  if (Array.isArray(article.topics)) {
    article.topics.forEach((t) => {
      if (typeof t === "string") topics.add(t);
    });
  }
  return Array.from(topics);
}

type ImagesMode = "all" | "first" | "hero";
const MODE_KEY = "ffa_images_mode";

export default function BetaArticleCard({
  article,
  index,
}: {
  article: Article;
  index: number;
}) {
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

  const headlineOnly = mode === "hero";
  const showImage = mode === "all" ? true : mode === "first" ? index === 0 : false;
  const displayImage = image && showImage ? image : null;
  const why = displayWhyMatters(article);

  return (
    <article
      className={
        headlineOnly
          ? "border-b border-zinc-200/70 py-3"
          : "group flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
      }
    >
      {displayImage ? (
        <div className="relative aspect-[16/9] w-full overflow-hidden rounded-xl bg-zinc-100">
          <Image
            src={displayImage}
            alt=""
            fill
            sizes="(max-width: 768px) 100vw, 50vw"
            className="object-cover"
            referrerPolicy="no-referrer"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
      ) : null}

      <div className="flex items-center gap-2 text-xs text-zinc-500">
        {!headlineOnly ? (
          favicon ? (
            <Image
              src={favicon}
              alt=""
              width={16}
              height={16}
              unoptimized
              className="h-4 w-4 rounded"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <span className="h-4 w-4 rounded bg-zinc-200" />
          )
        ) : null}
        <span className="font-medium text-zinc-700">{article.source ?? domain}</span>
        {!headlineOnly ? (
          <>
            <span>•</span>
            <span>{article.published_at ? new Date(article.published_at).toLocaleString() : ""}</span>
          </>
        ) : null}
      </div>

      <div className="space-y-2">
        <Link href={href} target="_blank" rel="noreferrer" className="block">
          <h3 className="text-base font-semibold leading-snug text-zinc-900 group-hover:text-emerald-700">
            {title}
          </h3>
        </Link>
        {!headlineOnly ? (
          {why ? <p className="text-sm text-zinc-600">{why}</p> : null}
        ) : null}
      </div>

      {!headlineOnly ? (
        <div className="flex items-center justify-between gap-2">
          <BetaTopicPills topics={getTopics(article)} />
          <Link
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-semibold uppercase tracking-wide text-emerald-700"
          >
            Read source →
          </Link>
        </div>
      ) : null}
    </article>
  );
}
