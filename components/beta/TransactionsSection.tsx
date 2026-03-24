"use client";

import { useState, useEffect } from "react";
import BetaSection from "@/components/beta/BetaSection";

interface Transaction {
  id: string;
  date: string;
  type: string;
  description: string;
}

export default function TransactionsSection({ teamId }: { teamId: string }) {
  const [items, setItems] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/transactions?team=${teamId}`)
      .then(r => r.json())
      .then(data => setItems(data.transactions || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [teamId]);

  if (loading) {
    return (
      <BetaSection title="Recent Transactions" subtitle="Team roster moves">
        <div className="text-sm text-zinc-500 py-4">Loading...</div>
      </BetaSection>
    );
  }

  if (items.length === 0) {
    return null;
  }

  const icons: Record<string, string> = {
    SIGNING: "✍️", TRADE: "🔄", RELEASE: "📤", DRAFT: "🎯", OTHER: "📰"
  };

  const colors: Record<string, string> = {
    SIGNING: "bg-emerald-100 text-emerald-800 border-emerald-200",
    TRADE: "bg-blue-100 text-blue-800 border-blue-200",
    RELEASE: "bg-rose-100 text-rose-800 border-rose-200",
    DRAFT: "bg-purple-100 text-purple-800 border-purple-200",
    OTHER: "bg-zinc-100 text-zinc-800 border-zinc-200",
  };

  return (
    <BetaSection title="Recent Transactions" subtitle="Team roster moves">
      <div className="space-y-2">
        {items.map(t => (
          <div key={t.id} className="rounded-lg border border-zinc-200 bg-white p-3">
            <div className="flex items-start gap-3">
              <span className="text-xl">{icons[t.type] || "📰"}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${colors[t.type] || colors.OTHER}`}>
                    {t.type}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {new Date(t.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                </div>
                <p className="text-sm text-zinc-900">{t.description}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </BetaSection>
  );
}
