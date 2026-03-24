"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { Team } from "@/lib/teams";

interface FilterBannerProps {
  team: Team;
  matchCount: number;
  timeWindow?: string;
}

export default function FilterBanner({ team, matchCount, timeWindow = "48 hours" }: FilterBannerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function clearFilter() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("team");
    router.push(params.toString() ? `/?${params.toString()}` : "/");
  }

  return (
    <div className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-700">
              <path d="M21 21H3C3 17.1 6.1 14 10 14c1.1 0 2 .9 2 2v4h2v-4c0-1.1.9-2 2-2 3.9 0 7 3.1 7 7z"></path>
              <circle cx="7" cy="7" r="4"></circle>
              <circle cx="17" cy="7" r="4"></circle>
            </svg>
            <h2 className="text-lg font-semibold text-emerald-900">{team.name}</h2>
          </div>
          <p className="text-sm text-emerald-700">
            {matchCount > 0 ? (
              <>
                {matchCount} article{matchCount !== 1 ? "s" : ""} in last {timeWindow}
              </>
            ) : (
              <>
                No articles found in last {timeWindow}.{" "}
                <span className="font-medium">Showing general NFL news below.</span>
              </>
            )}
          </p>
        </div>
        <button
          onClick={clearFilter}
          className="flex items-center gap-1.5 rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-sm font-medium text-emerald-900 hover:bg-emerald-100 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18"></path>
            <path d="m6 6 12 12"></path>
          </svg>
          Clear
        </button>
      </div>
    </div>
  );
}
