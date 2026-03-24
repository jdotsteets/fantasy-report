"use client";

import { useState, useEffect } from "react";
import BetaSection from "@/components/beta/BetaSection";

interface Transaction {
  id: number;
  date: string;
  team: string;
  teamKey: string;
  player: string;
  position: string;
  type: string;
  typeRaw: string;
  details?: string;
  sourceUrl?: string;
}

const TYPE_COLORS: Record<string, string> = {
  Signed: "bg-emerald-100 text-emerald-800 border-emerald-200",
  Released: "bg-rose-100 text-rose-800 border-rose-200",
  Waived: "bg-amber-100 text-amber-800 border-amber-200",
  Traded: "bg-blue-100 text-blue-800 border-blue-200",
  Claimed: "bg-purple-100 text-purple-800 border-purple-200",
  Activated: "bg-green-100 text-green-800 border-green-200",
  "Placed on IR": "bg-red-100 text-red-800 border-red-200",
  "Placed on Reserve": "bg-orange-100 text-orange-800 border-orange-200",
  Elevated: "bg-cyan-100 text-cyan-800 border-cyan-200",
  "Practice Squad": "bg-indigo-100 text-indigo-800 border-indigo-200",
  Other: "bg-zinc-100 text-zinc-800 border-zinc-200",
};

export default function LatestTransactions({ teamId }: { teamId?: string }) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const url = teamId 
      ? `/api/transactions?team=${teamId}&limit=10`
      : `/api/transactions?limit=10`;
      
    fetch(url)
      .then(r => r.json())
      .then(data => setTransactions(data.transactions || []))
      .catch(() => setTransactions([]))
      .finally(() => setLoading(false));
  }, [teamId]);

  if (loading) {
    return (
      <BetaSection title="Latest Transactions" subtitle="Recent roster moves">
        <div className="text-sm text-zinc-500 py-4">Loading transactions...</div>
      </BetaSection>
    );
  }

  if (transactions.length === 0) {
    return (
      <BetaSection title="Latest Transactions" subtitle="Recent roster moves">
        <div className="text-sm text-zinc-600 py-4">
          {teamId 
            ? "No recent transactions found for this team."
            : "No recent transactions available."}
        </div>
      </BetaSection>
    );
  }

  return (
    <BetaSection title="Latest Transactions" subtitle="Recent roster moves">
      <div className="space-y-2">
        {transactions.map(t => (
          <div 
            key={t.id} 
            className="flex items-center gap-3 px-3 py-2 rounded-lg border border-zinc-200 bg-white hover:border-zinc-300 transition"
          >
            {/* Date */}
            <div className="flex-shrink-0 w-16 text-xs text-zinc-500">
              {new Date(t.date).toLocaleDateString("en-US", { 
                month: "short", 
                day: "numeric" 
              })}
            </div>

            {/* Team */}
            <div className="flex-shrink-0 w-12 text-xs font-semibold text-zinc-700">
              {t.teamKey || "NFL"}
            </div>

            {/* Player & Position */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-zinc-900 truncate">
                  {t.player}
                </span>
                {t.position && (
                  <span className="text-xs text-zinc-500 flex-shrink-0">
                    {t.position}
                  </span>
                )}
              </div>
            </div>

            {/* Type Badge */}
            <div className="flex-shrink-0">
              <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TYPE_COLORS[t.type] || TYPE_COLORS.Other}`}>
                {t.type}
              </span>
            </div>

            {/* Source Link */}
            {t.sourceUrl && (
              <a
                href={t.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-shrink-0 text-zinc-400 hover:text-zinc-600 transition"
                title="View source"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                  <polyline points="15 3 21 3 21 9"></polyline>
                  <line x1="10" y1="14" x2="21" y2="3"></line>
                </svg>
              </a>
            )}
          </div>
        ))}
      </div>
    </BetaSection>
  );
}