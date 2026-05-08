import Link from "next/link";

const LINKS = [
  { label: "News", href: "/?section=news", key: "news" },
  { label: "Rankings", href: "/?section=rankings", key: "rankings" },
  { label: "Start/Sit", href: "/?section=start-sit", key: "start-sit" },
  { label: "Waiver Wire", href: "/?section=waivers", key: "waivers" },
  { label: "Advice", href: "/?section=advice", key: "advice" },
  { label: "DFS", href: "/?section=dfs", key: "dfs" },
  { label: "Injuries", href: "/?section=injury", key: "injury" },
] as const;

export default function BetaNav({
  currentSection,
}: {
  currentSection?: string | null;
}) {
  return (
    <nav className="flex flex-wrap items-center gap-2" role="navigation" aria-label="Content sections">
      {LINKS.map((link) => {
        const isActive = currentSection === link.key;
        return (
          <Link
            key={link.key}
            href={link.href}
            className={
              isActive
                ? "rounded-full bg-emerald-700 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-white shadow-sm"
                : "rounded-full border border-zinc-200 bg-white px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-600 shadow-sm hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700"
            }
            aria-current={isActive ? "page" : undefined}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
