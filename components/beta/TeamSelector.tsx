"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { NFL_TEAMS, type Team } from "@/lib/teams";

export default function TeamSelector() {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentTeamId = searchParams.get("team");

  const currentTeam = currentTeamId ? NFL_TEAMS.find(t => t.id === currentTeamId) : null;

  const filteredTeams = search
    ? NFL_TEAMS.filter(team =>
        team.name.toLowerCase().includes(search.toLowerCase()) ||
        team.shortName.toLowerCase().includes(search.toLowerCase())
      )
    : NFL_TEAMS;

  const groupedTeams = filteredTeams.reduce((acc, team) => {
    if (!acc[team.division]) acc[team.division] = [];
    acc[team.division].push(team);
    return acc;
  }, {} as Record<string, Team[]>);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  function selectTeam(teamId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("team", teamId);
    router.push(`/?${params.toString()}`);
    setIsOpen(false);
    setSearch("");
  }

  function clearFilter() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("team");
    router.push(params.toString() ? `/?${params.toString()}` : "/");
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
          currentTeam
            ? "bg-emerald-100 text-emerald-900 hover:bg-emerald-200"
            : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
        }`}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 21H3C3 17.1 6.1 14 10 14c1.1 0 2 .9 2 2v4h2v-4c0-1.1.9-2 2-2 3.9 0 7 3.1 7 7z"></path>
          <circle cx="7" cy="7" r="4"></circle>
          <circle cx="17" cy="7" r="4"></circle>
        </svg>
        <span>{currentTeam ? currentTeam.shortName : "Teams"}</span>
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${isOpen ? "rotate-180" : ""}`}>
          <path d="m6 9 6 6 6-6"></path>
        </svg>
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-72 rounded-lg border border-zinc-200 bg-white shadow-lg z-50">
          <div className="p-3 border-b border-zinc-100">
            <input
              type="text"
              placeholder="Search teams..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              autoFocus
            />
          </div>

          {currentTeam && (
            <div className="p-2 border-b border-zinc-100">
              <button
                onClick={clearFilter}
                className="w-full flex items-center gap-2 rounded-md px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18"></path>
                  <path d="m6 6 12 12"></path>
                </svg>
                Clear filter
              </button>
            </div>
          )}

          <div className="max-h-96 overflow-y-auto p-2">
            {Object.entries(groupedTeams).map(([division, teams]) => (
              <div key={division} className="mb-3">
                <div className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  {division}
                </div>
                <div className="space-y-1">
                  {teams.map((team) => (
                    <button
                      key={team.id}
                      onClick={() => selectTeam(team.id)}
                      className={`w-full flex items-center justify-between rounded-md px-3 py-2 text-sm text-left transition-colors ${
                        currentTeamId === team.id
                          ? "bg-emerald-50 text-emerald-900 font-medium"
                          : "text-zinc-700 hover:bg-zinc-50"
                      }`}
                    >
                      <span>{team.shortName}</span>
                      {currentTeamId === team.id && (
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-700">
                          <path d="M20 6 9 17l-5-5"></path>
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
