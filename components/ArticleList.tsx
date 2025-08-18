// components/ArticleList.tsx
type Article = {
  id: number;
  title: string;            // already cleaned in the SELECT
  source: string;
  url: string;              // not used in link (we use /go/[id]), but nice to have
  published_at: string | null;
  topics: string[] | null;
  week: number | null;
};

function fmt(d: string | null) {
  if (!d) return "—";
  try { return new Date(d).toLocaleString(); } catch { return "—"; }
}

export default function ArticleList({ items }: { items: Article[] }) {
  if (!items || items.length === 0) {
    return <div className="text-gray-500">No articles yet.</div>;
  }

  return (
    <ul className="space-y-3">
      {items.map((a) => (
        <li key={a.id} className="flex flex-col">
          <div className="flex items-center gap-2">
            {/* 🔵 Tracked redirect: /go/[id] */}
            <a
              className="text-blue-600 hover:underline"
              href={`/go/${a.id}`}
              target="_blank"
              rel="noreferrer"
            >
              {a.title}
            </a>
            <span className="text-sm text-gray-500">({a.source})</span>
          </div>
          <div className="text-xs text-gray-500">
            {fmt(a.published_at)}
            {Array.isArray(a.topics) && a.topics.length > 0 && (
              <> • {a.topics.join(", ")}{a.week ? ` • Week ${a.week}` : ""}</>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
