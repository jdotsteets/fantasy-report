import Image from "next/image";

export type Article = {
  id: number;
  title: string;
  url: string;
  source: string;
  published_at: string | null;
  topics: string[] | null;
  week: number | null;
  popularity?: number | null;
  thumbnail_url?: string | null; // optional small image, if available
};

function timeAgo(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  const mins = Math.max(1, Math.floor((Date.now() - d.getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

export default function ArticleLink({ a }: { a: Article }) {
  return (
    <li className="group border-b border-zinc-200 py-2">
      {/* 2‑col on md+: [content | source]; 1‑col on mobile */}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto] md:items-start">
        {/* Left: thumb + title + meta */}
        <div className="min-w-0 flex items-start gap-3">
          {a.thumbnail_url ? (
            <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded">
              <Image
                src={a.thumbnail_url}
                alt=""
                width={40}
                height={40}
                className="object-cover"
                unoptimized
              />
            </div>
          ) : null}

          <div className="min-w-0 flex-1">
            <a
              href={`/go/${a.id}`}
              target="_blank"
              rel="noreferrer"
              className="block truncate text-[13px] leading-5 text-black"
              title={a.title}
            >
              {a.title}
            </a>

            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] leading-4 text-zinc-500">
              <time dateTime={a.published_at || undefined}>{timeAgo(a.published_at)}</time>
              {Array.isArray(a.topics) && a.topics.length > 0 && (
                <>
                  <span>•</span>
                  <span className="space-x-1">
                    {a.topics.slice(0, 3).map((t) => (
                      <span key={t} className="rounded bg-zinc-100 px-1.5 py-0.5">
                        {t}
                      </span>
                    ))}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right: source (right‑aligned on md+) */}
        <div className="text-right text-[11px] leading-4 text-zinc-500 md:pt-0.5">
          {a.source}
        </div>
      </div>

      {a.popularity ? (
        <div className="mt-1 text-right md:hidden">
          <span className="inline-block rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600">
            🔥 {a.popularity}
          </span>
        </div>
      ) : null}
    </li>
  );
}
