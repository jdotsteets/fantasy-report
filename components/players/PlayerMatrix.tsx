"use client";

import React, { useMemo, useState } from "react";
import { ExternalLink, PlusCircle, MinusCircle, RotateCcw } from "lucide-react";

export type PlayerEntry = {
  key: string;
  name: string;
  links: Record<string, string>;
  lastSeen: string;
};

type PlayerArticle = {
  id: number;
  title: string;
  url: string;
  domain: string;
  source: string;
  primary_topic: string | null;
  is_player_page: boolean;
  ts: string; // ISO
  image_url: string | null;
};

type RowState = {
  loading: boolean;
  error: string | null;
  items: PlayerArticle[] | null;
  open: boolean;
};

export default function PlayerMatrix(props: { players: PlayerEntry[]; domains: string[] }) {
  const { players, domains } = props;
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Record<string, RowState>>({});

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return players;
    return players.filter((p) => p.name.toLowerCase().includes(s));
  }, [players, q]);

  async function fetchArticles(key: string) {
    setRows((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? { open: true }), loading: true, error: null },
    }));

    try {
      const res = await fetch(
        `/api/players/${encodeURIComponent(key)}/articles?days=60&limit=40`,
        { cache: "no-store" }
      );

      if (!res.ok) {
        let errText = `HTTP ${res.status}`;
        try {
          const ct = res.headers.get("content-type") ?? "";
          if (ct.includes("application/json")) {
            const body = (await res.json()) as { error?: string };
            if (body?.error) errText = body.error;
          } else {
            errText = await res.text();
          }
        } catch {
          // ignore parse failures, keep errText
        }
        throw new Error(errText || "Request failed");
      }

      const data = (await res.json()) as { items?: PlayerArticle[] };
      setRows((prev) => ({
        ...prev,
        [key]: { ...(prev[key] as RowState), loading: false, items: data.items ?? [] },
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load";
      setRows((prev) => ({
        ...prev,
        [key]: { ...(prev[key] as RowState), loading: false, error: msg },
      }));
    }
  }

  async function toggleRow(key: string) {
    setRows((prev) => {
      const cur = prev[key] ?? { loading: false, error: null, items: null, open: false };
      return { ...prev, [key]: { ...cur, open: !cur.open } };
    });

    // If opening and we don't have items yet, fetch them
    const cur = rows[key];
    const willOpen = !(cur?.open ?? false);
    if (willOpen && (!cur || (!cur.items && !cur.loading))) {
      await fetchArticles(key);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input
          className="h-9 w-72 rounded border px-3 text-sm"
          placeholder="Search player…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="text-sm text-gray-500">{filtered.length} players</div>
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <table className="min-w-[720px] w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left font-semibold w-8" />
              <th className="px-3 py-2 text-left font-semibold">Player</th>
              {domains.map((d) => (
                <th key={d} className="px-3 py-2 text-left font-semibold">
                  {d}
                </th>
              ))}
              <th className="px-3 py-2 text-left font-semibold">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => {
              const state = rows[p.key] ?? { loading: false, error: null, items: null, open: false };
              return (
                <React.Fragment key={p.key}>
                  <tr className="border-t">
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        aria-expanded={state.open}
                        onClick={() => toggleRow(p.key)}
                        className="inline-flex items-center text-gray-700 hover:text-black"
                        title={state.open ? "Collapse" : "Expand"}
                      >
                        {state.open ? <MinusCircle size={18} /> : <PlusCircle size={18} />}
                      </button>
                    </td>
                    <td className="px-3 py-2 font-medium">
                      <button
                        type="button"
                        className="hover:underline"
                        onClick={() => toggleRow(p.key)}
                        title="Show recent articles"
                      >
                        {p.name}
                      </button>
                    </td>
                    {domains.map((d) => {
                      const href = p.links[d];
                      return (
                        <td key={d} className="px-3 py-2">
                          {href ? (
                            <a
                              href={href}
                              target="_blank"
                              rel="noreferrer"
                              title={href}
                              className="inline-flex items-center gap-1 hover:underline"
                            >
                              <ExternalLink size={14} /> Link
                            </a>
                          ) : (
                            <span
                              aria-label="no link"
                              className="inline-block h-2 w-2 rounded-full bg-gray-300 align-middle"
                            />
                          )}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-gray-500">
                      {new Date(p.lastSeen).toLocaleString()}
                    </td>
                  </tr>

                  {state.open && (
                    <tr>
                      <td colSpan={domains.length + 3} className="px-3 pb-4">
                        <div className="rounded-lg bg-gray-50 p-3">
                          {state.loading && (
                            <div className="text-sm text-gray-500">Loading…</div>
                          )}
                          {state.error && (
                            <div className="flex items-center gap-3">
                              <div className="text-sm text-red-600">{state.error}</div>
                              <button
                                type="button"
                                onClick={() => fetchArticles(p.key)}
                                className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-white"
                                title="Retry"
                              >
                                <RotateCcw size={14} />
                                Retry
                              </button>
                            </div>
                          )}
                          {!state.loading && !state.error && (
                            <ul className="space-y-2">
                              {(state.items ?? []).map((a) => (
                                <li key={a.id} className="rounded border bg-white p-2">
                                  <a
                                    href={a.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="font-medium hover:underline"
                                  >
                                    {a.title}
                                  </a>
                                  <div className="text-xs text-gray-500">
                                    {a.source} • {a.domain} •{" "}
                                    {new Date(a.ts).toLocaleString()}
                                    {a.primary_topic ? ` • ${a.primary_topic}` : ""}
                                    {a.is_player_page ? " • player page" : ""}
                                  </div>
                                </li>
                              ))}
                              {state.items && state.items.length === 0 && (
                                <div className="text-sm text-gray-500">
                                  No recent articles found.
                                </div>
                              )}
                            </ul>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
