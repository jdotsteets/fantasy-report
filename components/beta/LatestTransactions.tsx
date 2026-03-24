"use client";

import { useEffect, useState } from "react";
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

const INITIAL_DISPLAY = 5;

export default function LatestTransactions({ teamId }: { teamId?: string }) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const url = teamId
      ? "/api/transactions?team=" + teamId + "&limit=25"
      : "/api/transactions?limit=25";

    setLoading(true);
    setExpanded(false);

    fetch(url)
      .then((r) => r.json())
      .then((data) => setTransactions(data.transactions || []))
      .catch(() => setTransactions([]))
      .finally(() => setLoading(false));
  }, [teamId]);

  const visibleTransactions = expanded
    ? transactions
    : transactions.slice(0, INITIAL_DISPLAY);

  const showToggle = transactions.length > INITIAL_DISPLAY;
  const remaining = transactions.length - INITIAL_DISPLAY;

  if (loading) {
    return (
      <BetaSection title="Latest Transactions" subtitle="Recent roster moves">
        <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-6 text-sm text-zinc-500">
          Loading transactions...
        </div>
      </BetaSection>
    );
  }

  if (transactions.length === 0) {
    return (
      <BetaSection title="Latest Transactions" subtitle="Recent roster moves">
        <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-6 text-sm text-zinc-600">
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
        {visibleTransactions.map((t) => (
          <div
            key={t.id}
            className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2 transition hover:border-zinc-300"
          >
            <div className="w-16 text-xs text-zinc-500">
              {new Date(t.date).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </div>

            <div className="w-12 text-xs font-semibold text-zinc-700">
              {t.teamKey || "NFL"}
            </div>

            <div className="flex-1 min-w-0">
              <span className="text-sm font-semibold text-zinc-900 truncate">
                {t.player}
              </span>
            </div>

            <div>
              <span
                className={
                  "inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold " +
                  (TYPE_COLORS[t.type] || TYPE_COLORS.Other)
                }
              >
                {t.type}
              </span>
            </div>
          </div>
        ))}
      </div>

      {showToggle && (
        <div className="mt-4 border-t border-zinc-100 pt-4">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-sm font-medium text-zinc-700 hover:text-zinc-900"
          >
            {expanded
              ? "Show less"
              : "More transactions (" + remaining + " more)"}
          </button>
        </div>
      )}
    </BetaSection>
  );
}
