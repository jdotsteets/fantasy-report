'use client';
import * as React from 'react';

function effectiveUrl(home?: string | null, path?: string | null) {
  if (!home) return '';
  try {
    const base = new URL(home);
    if (path && path.trim()) return new URL(path, base).toString();
    return base.toString();
  } catch {
    return home;
  }
}

export default function SelectorTester({
  sourceId,
  homepageUrl,
  scrapePath,      // <— NEW
  defaultSelector,
}: {
  sourceId: number;
  homepageUrl: string | null;
  scrapePath?: string | null;     // <— NEW
  defaultSelector: string | null;
}) {
  const [url, setUrl] = React.useState(() => effectiveUrl(homepageUrl ?? '', scrapePath ?? '')); // <—
  const [selector, setSelector] = React.useState(defaultSelector ?? '');
  const [limit, setLimit] = React.useState(20);
  const [result, setResult] = React.useState<string | null>(null);

  async function onTest() {
    const qs = new URLSearchParams({
      task: 'testScrape',
      id: String(sourceId), // route now accepts id|sourceId
      limit: String(limit),
      url,
      selector,
      log: '1',
    });
    const res = await fetch(`/api/admin?${qs.toString()}`, { cache: 'no-store' });
    const j = await res.json().catch(() => ({}));
    setResult(JSON.stringify(j, null, 2));
  }

  return (
    <div className="rounded-xl border p-3 space-y-2">
      <div className="text-sm font-medium">Selector Tester</div>
      <label className="block text-xs font-medium">URL</label>
      <input className="w-full rounded border px-2 py-1 text-sm"
             value={url} onChange={e => setUrl(e.target.value)}
             placeholder="https://example.com/section" />
      <label className="block text-xs font-medium">CSS selector</label>
      <input className="w-full rounded border px-2 py-1 text-sm"
             value={selector} onChange={e => setSelector(e.target.value)} />
      <div className="flex items-center gap-3">
        <label className="text-xs">Limit</label>
        <input className="w-20 rounded border px-2 py-1 text-sm"
               type="number" value={limit}
               onChange={e => setLimit(Number(e.target.value) || 20)} />
        <button onClick={onTest}
                className="ml-auto h-8 rounded-md bg-zinc-900 px-3 text-sm font-medium text-white hover:bg-black">
          Test
        </button>
      </div>
      {result ? <pre className="mt-2 max-h-56 overflow-auto rounded bg-zinc-50 p-2 text-xs">{result}</pre> : null}
    </div>
  );
}
