// components/TopToolbar.tsx
"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import {
  Newspaper, TrendingUp, Stethoscope, Scale, Coins, Lightbulb, Users, UserPlus,
  Briefcase, FileText,
  LucideIcon,
} from "lucide-react";
import SourceTab from "@/components/SourceTab";

type Item = { slug: string; label: string; icon: LucideIcon; route?: string };

// Determine season mode on client (matches server logic)
function getClientSeasonMode(): "regular" | "off-season" | "preseason" {
  const now = new Date();
  const month = now.getMonth() + 1; // 1-12
  const day = now.getDate();
  
  // Off-Season: Feb 1 - May 10
  if ((month === 2) || (month === 3) || (month === 4) || (month === 5 && day <= 10)) {
    return "off-season";
  }
  
  // Preseason: July 25 - Sept 10
  if ((month === 7 && day >= 25) || (month === 8) || (month === 9 && day <= 10)) {
    return "preseason";
  }
  
  return "regular";
}

function getSeasonalItems(mode: "regular" | "off-season" | "preseason"): ReadonlyArray<Item> {
  const base: Item[] = [
    { slug: "rankings",  label: "Rankings",  icon: TrendingUp },
    { slug: "news",      label: "News",      icon: Newspaper },
  ];
  
  if (mode === "off-season") {
    return [
      ...base.slice(0, 1), // Rankings
      { slug: "free-agency", label: "Free Agency", icon: Briefcase },
      { slug: "nfl-draft",   label: "NFL Draft",   icon: FileText },
      { slug: "advice",      label: "Advice",      icon: Lightbulb },
      { slug: "injury",      label: "Injuries",    icon: Stethoscope },
      { slug: "dfs",         label: "DFS",         icon: Coins },
      ...base.slice(1), // News
    ];
  }
  
  if (mode === "preseason") {
    return [
      ...base,
      { slug: "advice",    label: "Advice",    icon: Lightbulb },
      { slug: "injury",    label: "Injuries",  icon: Stethoscope },
      { slug: "dfs",       label: "DFS",       icon: Coins },
      { slug: "players",   label: "Players",   icon: Users, route: "/players" },
    ];
  }
  
  // Regular season
  return [
    { slug: "waivers",   label: "Waivers",   icon: UserPlus },
    ...base,
    { slug: "start-sit", label: "Start/Sit", icon: Scale },
    { slug: "advice",    label: "Advice",    icon: Lightbulb },
    { slug: "injury",    label: "Injuries",  icon: Stethoscope },
    { slug: "dfs",       label: "DFS",       icon: Coins },
    { slug: "players",   label: "Players",   icon: Users, route: "/players" },
  ];
}

export default function TopToolbar() {
  return (
    <Suspense fallback={null}>
      <ToolbarInner />
    </Suspense>
  );
}

function ToolbarInner() {
  const pathname = usePathname() ?? "/";
  const searchParams = useSearchParams();
  const [seasonMode, setSeasonMode] = useState<"regular" | "off-season" | "preseason">("regular");

  useEffect(() => {
    setSeasonMode(getClientSeasonMode());
  }, []);

  const items = getSeasonalItems(seasonMode);
  const activeSection = searchParams.get("section") ?? "";
  const onPlayers = pathname.startsWith("/players");

  const makeHref = (nextSection?: string) => {
    const qp = new URLSearchParams(searchParams.toString());
    if (nextSection) qp.set("section", nextSection);
    else qp.delete("section");
    return nextSection ? `/?${qp.toString()}` : `/?${qp.toString()}`.replace("/?","/");
  };

  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);
  const ticking = useRef(false);
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY || 0;
      if (ticking.current) return;
      ticking.current = true;
      requestAnimationFrame(() => {
        const delta = y - lastY.current;
        if (y < 8) setHidden(false);
        else if (delta > 12) setHidden(true);
        else if (delta < -8) setHidden(false);
        lastY.current = y;
        ticking.current = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="sticky top-[var(--header-h,56px)] z-40">
      <div className={`transition-transform duration-300 will-change-transform ${hidden ? "-translate-y-full opacity-0 pointer-events-none" : "translate-y-0 opacity-100"}`}>
        <nav className="border-b border-zinc-200 bg-white/85 backdrop-blur supports-[backdrop-filter]:bg-white/60">
          <ul className="mx-auto max-w-6xl flex items-center justify-between gap-1 px-2 py-1 overflow-x-auto no-scrollbar">
            {items.map((item) => {
              const { slug, label, icon: Icon } = item;
              const isActive = item.route ? onPlayers : activeSection === slug;
              const href = item.route ? item.route : makeHref(isActive ? undefined : slug);
              return (
                <li key={slug} className="flex-1 min-w-[60px]">
                  <Link
                    href={href}
                    aria-current={isActive ? "page" : undefined}
                    title={isActive ? "Clear section filter" : label}
                    className={`group flex flex-col items-center gap-0.5 rounded-lg px-2 py-1 text-xs transition-colors ${
                      isActive ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-zinc-100"
                    }`}
                  >
                    <Icon size={16} aria-hidden="true" />
                    <span className="block text-[10px] leading-tight font-normal text-zinc-600 group-aria-[current=page]:text-white sm:text-[11px]">
                      {label}
                    </span>
                  </Link>
                </li>
              );
            })}
            <SourceTab />
          </ul>
        </nav>
      </div>
    </div>
  );
}
