// components/ArticleLink.tsx
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
    <li className="group flex items-start gap-3 border-b border-zinc-200 py-2">
      {/* Thumbnail (optional) */}
      {a.thumbnail_url ? (
        <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded">
          <Image
            src={a.thumbnail_url}
            alt=""
            width={40}
            height={40}
            className="object-cover"
            // We use many remote domains; skip optimization to avoid configuring every host for now
            unoptimized
          />
        </div>
      ) : null}

      <div className="min-w-0 flex-1">
        <a
          href={`/go/${a.id}`}
          target="_blank"
          rel="noreferrer"
          className="block truncate text-[14px] leading-6 text-black no-underline hover:underline"
          title={a.title}
        >
          {a.title}
        </a>
        <div className="mt-0.5 text-xs text-zinc-500">
          <span>{a.source}</span>
          <span className="mx-2">•</span>
          <time dateTime={a.published_at || undefined}>{timeAgo(a.published_at)}</time>
          {Array.isArray(a.topics) && a.topics.length > 0 && (
            <>
              <span className="mx-2">•</span>
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

      {a.popularity ? (
        <span className="ml-2 shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600">
          🔥 {a.popularity}
        </span>
      ) : null}
    </li>
  );
}
