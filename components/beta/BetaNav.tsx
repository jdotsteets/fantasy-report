import TeamSelector from "@/components/beta/TeamSelector";

const LINKS = [
  { label: "News", href: "/beta?section=news" },
  { label: "Rankings", href: "/beta?section=rankings" },
  { label: "Start/Sit", href: "/beta?section=start-sit" },
  { label: "Waiver Wire", href: "/beta?section=waivers" },
  { label: "Advice", href: "/beta?section=advice" },
  { label: "DFS", href: "/beta?section=dfs" },
  { label: "Injuries", href: "/beta?section=injury" },
];

export default function BetaNav() {
  return (
    <nav className="flex flex-wrap items-center gap-2">
      <TeamSelector />
      {LINKS.map((link) => (
        <a
          key={link.href}
          href={link.href}
          className="rounded-full border border-zinc-200 bg-white px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-600 hover:border-emerald-300 hover:text-emerald-700"
        >
          {link.label}
        </a>
      ))}
    </nav>
  );
}
