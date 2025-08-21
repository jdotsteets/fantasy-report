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
 <ul className="space-y-3">
  {items.map((r) => (
    <li key={r.id} className="group">
      {/* Headline */}
      <a
        href={`/go/${r.id}`}
        target="_blank"
        rel="noreferrer"
        className="mt-1 flex text-[12px] font-bold leading-snug text-black no-underline hover:text-green-900"
        title={r.title}
      >
        {r.title}
      </a>

      {/* Meta row */}
      <div className="mt-0 flex flex-wrap items-center gap-x-2 text-[11px] text-zinc-700 leading-tight">
        <span>{fmtDate(r.published_at)}</span>
        <span>• {r.source}</span>
        {r.week ? <span>• Week {r.week}</span> : null}
      </div>
    </li>
  ))}
</ul>

  );
}
