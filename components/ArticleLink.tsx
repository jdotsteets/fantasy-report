// components/ArticleLink.tsx

export type Article = {
  id: number;
  title: string;
  url: string;
  source: string;
  published_at: string | null;
  topics: string[] | null;
  week: number | null;
  popularity?: number | null;
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
    <li className="group flex items-start gap-3 border-b border-zinc-800 py-2">
      <div className="min-w-0 flex-1">
        <a
          href={`/go/${a.id}`}
          target="_blank"
          rel="noreferrer"
          className="block truncate text-[15px] leading-6 text-zinc-100 group-hover:text-white"
          title={a.title}
        >
          {a.title}
        </a>
        <div className="mt-0.5 text-xs text-zinc-400">
          <span>{a.source}</span>
          <span className="mx-2">•</span>
          <time dateTime={a.published_at || undefined}>{timeAgo(a.published_at)}</time>
          {Array.isArray(a.topics) && a.topics.length > 0 && (
            <>
              <span className="mx-2">•</span>
              <span className="space-x-1">
                {a.topics.slice(0, 3).map((t) => (
                  <span key={t} className="rounded bg-zinc-800 px-1.5 py-0.5">
                    {t}
                  </span>
                ))}
              </span>
            </>
          )}
        </div>
      </div>
      {a.popularity ? (
        <span className="ml-2 shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-300">
          🔥 {a.popularity}
        </span>
      ) : null}
    </li>
  );
}
