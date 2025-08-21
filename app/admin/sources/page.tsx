'use client';

import { useEffect, useMemo, useState } from 'react';

type SourceRow = {
  id: number;
  name: string;
  homepage_url: string | null;
  rss_url: string | null;
  favicon_url: string | null;
  sitemap_url: string | null;
  category: string | null;
  allowed: boolean | null;
  priority: number | null;
};

type FormState = {
  name: string;
  homepage_url?: string;
  rss_url?: string;
  favicon_url?: string;
  sitemap_url?: string;
  category?: string;
  priority?: number;
  allowed?: boolean;
};

const emptyForm: FormState = {
  name: '',
  homepage_url: '',
  rss_url: '',
  favicon_url: '',
  sitemap_url: '',
  category: '',
  priority: 0,
  allowed: true,
};

export default function SourcesAdminPage() {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState<SourceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetch('/api/admin/sources', { cache: 'no-store' });
    const data = (await res.json()) as SourceRow[];
    setRows(data);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);

    const res = await fetch('/api/admin/sources', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(form),
    });
    const data = await res.json();

    if (res.ok) {
      setMsg(`Saved! id=${data.id}`);
      setForm((f) => ({ ...emptyForm, category: f.category ?? '' })); // keep category if you want
      await load();
    } else {
      setMsg(`Error: ${data?.error ?? res.statusText}`);
    }

    setSaving(false);
  }

  async function toggleAllowed(id: number, allowed: boolean) {
    const res = await fetch('/api/admin/sources', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, allowed }),
    });
    if (res.ok) {
      setRows((r) => r.map((x) => (x.id === id ? { ...x, allowed } : x)));
    }
  }

  const sorted = useMemo(() => {
    // Same sort as before: Fantasy News first, then by category/name
    return [...rows].sort((a, b) => {
      const aFN = a.category === 'Fantasy News' ? 0 : 1;
      const bFN = b.category === 'Fantasy News' ? 0 : 1;
      if (aFN !== bFN) return aFN - bFN;
      const ac = (a.category ?? 'zzzz').localeCompare(b.category ?? 'zzzz');
      if (ac !== 0) return ac;
      return a.name.localeCompare(b.name);
    });
  }, [rows]);

  return (
    <main className="mx-auto max-w-[1100px] px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold">Sources Admin</h1>

      {/* Add / Update form */}
      <section className="mb-10 rounded-lg border border-zinc-200 p-4">
        <h2 className="mb-3 text-lg font-semibold">Add / Update Source</h2>

        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="flex flex-col text-sm">
            <span className="mb-1 font-medium">Name *</span>
            <input
              required
              className="rounded border px-3 py-2"
              placeholder="FantasyPros NFL"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>

          <label className="flex flex-col text-sm">
            <span className="mb-1 font-medium">Homepage URL</span>
            <input
              className="rounded border px-3 py-2"
              placeholder="https://www.example.com"
              value={form.homepage_url ?? ''}
              onChange={(e) => setForm({ ...form, homepage_url: e.target.value })}
            />
          </label>

          <label className="flex flex-col text-sm">
            <span className="mb-1 font-medium">RSS URL</span>
            <input
              className="rounded border px-3 py-2"
              placeholder="https://www.example.com/feed"
              value={form.rss_url ?? ''}
              onChange={(e) => setForm({ ...form, rss_url: e.target.value })}
            />
          </label>

          <label className="flex flex-col text-sm">
            <span className="mb-1 font-medium">Favicon URL</span>
            <input
              className="rounded border px-3 py-2"
              placeholder="https://www.example.com/favicon.ico"
              value={form.favicon_url ?? ''}
              onChange={(e) => setForm({ ...form, favicon_url: e.target.value })}
            />
          </label>

          <label className="flex flex-col text-sm">
            <span className="mb-1 font-medium">Sitemap URL</span>
            <input
              className="rounded border px-3 py-2"
              placeholder="https://www.example.com/sitemap.xml"
              value={form.sitemap_url ?? ''}
              onChange={(e) => setForm({ ...form, sitemap_url: e.target.value })}
            />
          </label>

          <label className="flex flex-col text-sm">
            <span className="mb-1 font-medium">Category</span>
            <select
              className="rounded border px-3 py-2"
              value={form.category ?? ''}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            >
              <option value="">(none)</option>
              <option>Fantasy News</option>
              <option>Rankings</option>
              <option>Start/Sit</option>
              <option>Injury</option>
              <option>DFS</option>
              <option>Dynasty</option>
              <option>Betting/DFS</option>
              <option>Podcast</option>
              <option>Team Site</option>
              <option>Other</option>
            </select>
          </label>

          <label className="flex flex-col text-sm">
            <span className="mb-1 font-medium">Priority (0 = highest)</span>
            <input
              type="number"
              min={0}
              className="rounded border px-3 py-2"
              value={form.priority ?? 0}
              onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
            />
          </label>

          <label className="mt-6 flex items-center gap-2 text-sm md:col-span-2">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={form.allowed ?? true}
              onChange={(e) => setForm({ ...form, allowed: e.target.checked })}
            />
            <span>Allowed</span>
          </label>

          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded bg-green-700 px-4 py-2 text-white hover:bg-green-800 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            {msg && <span className="ml-3 text-sm text-zinc-600">{msg}</span>}
          </div>
        </form>
      </section>

      {/* Existing sources */}
      <section className="rounded-lg border border-zinc-200">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50">
            <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left">
              <th>Name</th>
              <th>Category</th>
              <th>Homepage</th>
              <th>RSS</th>
              <th className="text-center">Allowed</th>
              <th className="text-right">Priority</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-zinc-500">
                  Loading…
                </td>
              </tr>
            ) : (
              sorted.map((s) => (
                <tr key={s.id} className="border-t">
                  <td className="px-3 py-2">{s.name}</td>
                  <td className="px-3 py-2">{s.category ?? '—'}</td>
                  <td className="px-3 py-2">
                    {s.homepage_url ? (
                      <a
                        href={s.homepage_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-700 hover:underline"
                      >
                        Homepage
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {s.rss_url ? (
                      <a
                        href={s.rss_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-700 hover:underline"
                      >
                        RSS
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button
                      onClick={() => toggleAllowed(s.id, !(s.allowed ?? true))}
                      className={`rounded px-2 py-1 ${
                        s.allowed ? 'bg-green-100 text-green-800' : 'bg-zinc-200 text-zinc-600'
                      }`}
                    >
                      {s.allowed ? 'Yes' : 'No'}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right">{s.priority ?? 0}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}
