// components/TopToolbar.tsx
"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import {
  Newspaper, TrendingUp, Stethoscope, Scale, Coins, Lightbulb, Users,
} from "lucide-react";
import SourceTab from "@/components/SourceTab";

type Item = { slug: string; label: string; icon: any; route?: string };

const items: ReadonlyArray<Item> = [
  { slug: "waivers",   label: "Waivers",   icon: Users },
  { slug: "rankings",  label: "Rankings",  icon: TrendingUp },
  { slug: "start-sit", label: "Start/Sit", icon: Scale },
  { slug: "advice",    label: "Advice",    icon: Lightbulb },
  { slug: "news",      label: "News",      icon: Newspaper },
  { slug: "injury",    label: "Injuries",  icon: Stethoscope },
  { slug: "dfs",       label: "DFS",       icon: Coins },
  { slug: "players",   label: "Players",   icon: Users, route: "/players" },
];

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

  const activeSection = searchParams.get("section") ?? "";
  const onPlayers = pathname.startsWith("/players");

  // helper: merge current query params, optionally set section
  const makeHref = (nextSection?: string) => {
    const qp = new URLSearchParams(searchParams.toString());
    if (nextSection) qp.set("section", nextSection);
    else qp.delete("section"); // home == no section
    // NOTE: we do NOT touch sourceId here, so it’s preserved
    return nextSection ? `/?${qp.toString()}` : `/?${qp.toString()}`.replace("/?","/");
  };

  // hide on scroll (unchanged)
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
    <div className="sticky top-[var(--header-h,64px)] z-40">
      <div className={`transition-transform duration-300 will-change-transform ${hidden ? "-translate-y-full opacity-0 pointer-events-none" : "translate-y-0 opacity-100"}`}>
        <nav className="border-b border-zinc-200 bg-white/85 backdrop-blur supports-[backdrop-filter]:bg-white/60">
          <ul className="mx-auto max-w-3xl flex items-center justify-between gap-1 px-3 py-2 overflow-x-auto no-scrollbar">
            {items.map((item) => {
              const { slug, label, icon: Icon } = item;
              const isActive = item.route ? onPlayers : activeSection === slug;
              const href = item.route
                ? item.route // optional: strip sourceId for /players if you don't want it there
                : (slug === "" ? makeHref(undefined) : makeHref(slug));
              return (
                <li key={slug} className="flex-1 min-w-[68px]">
                  <Link
                    href={href}
                    aria-current={isActive ? "page" : undefined}
                    className={`flex flex-col items-center gap-1 rounded-xl px-3 py-2 text-xs transition-colors ${
                      isActive ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-zinc-100"
                    }`}
                  >
                    <Icon size={18} aria-hidden="true" />
                    <span className="hidden sm:block">{label}</span>
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
