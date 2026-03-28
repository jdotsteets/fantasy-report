import TeamSelector from "@/components/beta/TeamSelector";

type SeasonMode = "regular" | "free-agency" | "draft";

type NavProps = {
  seasonMode?: SeasonMode;
};

function getLinks(mode: SeasonMode = "regular") {
  const base = [
    { label: "News", href: "/?section=news" },
    { label: "Rankings", href: "/?section=rankings" },
  ];

  if (mode === "draft") {
    return [
      ...base,
      { label: "NFL Draft", href: "/?section=nfl-draft" },
      { label: "Advice", href: "/?section=advice" },
      { label: "DFS", href: "/?section=dfs" },
      { label: "Injuries", href: "/?section=injury" },
    ];
  }

  if (mode === "free-agency") {
    return [
      ...base,
      { label: "Free Agency", href: "/?section=free-agency" },
      { label: "Start/Sit", href: "/?section=start-sit" },
      { label: "Advice", href: "/?section=advice" },
      { label: "DFS", href: "/?section=dfs" },
      { label: "Injuries", href: "/?section=injury" },
    ];
  }

  // Regular season
  return [
    ...base,
    { label: "Start/Sit", href: "/?section=start-sit" },
    { label: "Waiver Wire", href: "/?section=waivers" },
    { label: "Advice", href: "/?section=advice" },
    { label: "DFS", href: "/?section=dfs" },
    { label: "Injuries", href: "/?section=injury" },
  ];
}

export default function BetaNav({ seasonMode = "regular" }: NavProps) {
  const links = getLinks(seasonMode);

  return (
    <nav className="flex flex-wrap items-center gap-2">
      <TeamSelector />
      {links.map((link) => (
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
