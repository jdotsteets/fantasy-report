"use client";

import Image from "next/image";
import Link from "next/link";
import ArticleLink from "@/components/ArticleLink";
import type { Article } from "@/types/sources";

type Props = {
  items: Article[];
  title?: string;
  className?: string;
};

export default function ArticleList({ items, title, className }: Props) {
  return (
    <section
      className={[
        "rounded-2xl border border-zinc-200 bg-white",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {title ? (
        <header className="border-b border-zinc-200 px-4 py-3 sm:px-5">
          <h2 className="text-lg font-semibold">{title}</h2>
        </header>
      ) : null}

      <ul className="divide-y divide-zinc-200">
        {items.map((r) => {
          const href = r.canonical_url ?? r.url;
          return (
            <li key={r.id} className="px-4 py-3 sm:px-5">
              {r.image_url ? (
                <div className="relative mb-2 aspect-[16/9] w-full overflow-hidden rounded-md bg-zinc-100">
                  <Image
                    src={r.image_url}
                    alt=""
                    fill
                    sizes="(max-width: 768px) 100vw, 50vw"
                    className="object-cover"
                  />
                </div>
              ) : null}

              <Link href={href} target="_blank" rel="noreferrer" className="block">
                <div className="text-xs text-zinc-500">
                  {r.source}
                  {r.domain ? ` · ${r.domain}` : ""}
                </div>
                <h3 className="mt-1 line-clamp-2 font-medium text-zinc-900">
                  {r.title}
                </h3>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
