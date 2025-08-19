// app/components/ArticleList.tsx
type Item = {
  id: number;
  title: string;
  url: string;
  published_at: string | null;
  topics: string[] | null;
  week: number | null;
  source: string;
};

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString();
}

export default function ArticleList({ items }: { items: Item[] }) {
  if (!items?.length) {
    return <div className="text-sm text-zinc-400">No articles yet.</div>;
  }

  return (
    <ul className="space-y-2">
      {items.map((r) => (
        <li key={r.id} className="group">
          <div className="flex items-center gap-2">
            <a
              href={`/go/${r.id}`}
              target="_blank"
              rel="noreferrer"
              className="text-[15px] leading-snug group-hover:text-blue-200"
            >
              {r.title}
            </a>
            <span className="text-xs text-zinc-500">({r.source})</span>
          </div>

          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-zinc-500">
            <span>{fmtDate(r.published_at)}</span>
            {Array.isArray(r.topics) && r.topics.length > 0 && (
              <span>• {r.topics.join(", ")}</span>
            )}
            {r.week ? <span>• Week {r.week}</span> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
