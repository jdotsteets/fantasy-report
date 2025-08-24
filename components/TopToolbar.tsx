"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Newspaper, TrendingUp, Stethoscope, HandHeart, Swords, ShoppingCart, Lightbulb,
  type LucideIcon,
} from "lucide-react";

type Item = { slug: string; label: string; icon: LucideIcon };

const items: Item[] = [
  { slug: "waivers",   label: "Waivers",   icon: HandHeart },
  { slug: "rankings",  label: "Rankings",  icon: TrendingUp },
  { slug: "start-sit", label: "Start/Sit", icon: Swords },
  { slug: "injury",    label: "Injuries",  icon: Stethoscope },
  { slug: "dfs",       label: "DFS",       icon: ShoppingCart },
  { slug: "advice",    label: "Advice",    icon: Lightbulb },
  { slug: "news",      label: "News",      icon: Newspaper },
];

export default function TopToolbar() {
  const router = useRouter();

  // track current path & section without useSearchParams/usePathname
  const [active, setActive] = useState<string>(""); // section slug or ""

  useEffect(() => {
    // safe on client only
    const p = window.location.pathname || "/";
    const sp = new URLSearchParams(window.location.search);
    setActive(sp.get("section") ?? "");
  }, []);

  // hide on scroll down, show on scroll up
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

  const handleClick = (slug: string, isActive: boolean) => (e: React.MouseEvent) => {
    e.preventDefault();
    if (isActive) {
      router.push("/");                 // toggle off -> show all
      setActive("");
    } else {
      router.push(`/?section=${encodeURIComponent(slug)}`);
      setActive(slug);
    }
  };

  return (
    <div className="sticky top-[var(--header-h,64px)] z-40">
      <div
        className={`transition-transform duration-300 will-change-transform ${hidden ? "-translate-y-full opacity-0 pointer-events-none" : "translate-y-0 opacity-100"}`}
      >
        <nav className="border-b border-zinc-200 bg-white/85 backdrop-blur supports-[backdrop-filter]:bg-white/60">
          <ul className="mx-auto max-w-3xl flex items-center justify-between gap-1 px-3 py-2 overflow-x-auto no-scrollbar">
            {items.map(({ slug, label, icon: Icon }) => {
              const isActive = active === slug;
              const href = isActive ? "/" : `/?section=${slug}`;
              return (
                <li key={slug} className="flex-1 min-w-[68px]">
                  <Link
                    href={href}
                    onClick={handleClick(slug, isActive)}
                    aria-current={isActive ? "page" : undefined}
                    className={`flex flex-col items-center gap-1 rounded-xl px-3 py-2 text-xs transition-colors ${isActive ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-zinc-100"}`}
                  >
                    <Icon size={18} aria-hidden="true" />
                    <span className="hidden sm:block">{label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </div>
  );
}
