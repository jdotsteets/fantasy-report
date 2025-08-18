"use client";

import { useEffect, useState } from "react";

export default function ArticlesPage() {
  const [articles, setArticles] = useState([]);
  const [topic, setTopic] = useState("");
  const [week, setWeek] = useState("");

  useEffect(() => {
    fetch(`/api/articles?topic=${topic}&week=${week}`)
      .then(res => res.json())
      .then(setArticles);
  }, [topic, week]);

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold mb-4">Articles</h1>

      {/* Filters */}
      <div className="mb-4 flex gap-2">
        <select onChange={e => setTopic(e.target.value)}>
          <option value="">All Topics</option>
          <option value="waiver-wire">Waiver Wire</option>
          <option value="rankings">Rankings</option>
          <option value="start-sit">Start/Sit</option>
          <option value="trade">Trades</option>
          <option value="injury">Injuries</option>
          <option value="dfs">DFS</option>
          <option value="news">News</option>
        </select>

        <input
          type="number"
          placeholder="Week"
          value={week}
          onChange={e => setWeek(e.target.value)}
        />
      </div>

      {/* Articles List */}
      <ul>
        {articles.map((a: any) => (
          <li key={a.id} className="mb-3">
            <a href={a.url} target="_blank" rel="noreferrer" className="text-blue-600 font-medium">
              {a.title}
            </a>
            <div className="text-sm text-gray-600">
              {a.source} • {new Date(a.published_at).toLocaleDateString()}
            </div>
            <div className="text-xs text-gray-500">Topics: {a.topics.join(", ")}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
