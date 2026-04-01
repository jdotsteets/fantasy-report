import TeamSelector from "@/components/beta/TeamSelector";

type SeasonMode = "regular" | "off-season" | "preseason";

type NavProps = {
  seasonMode?: SeasonMode;
};

function getLinks(mode: SeasonMode = "regular") {
  const base = [
    { label: "News", href: "/?section=news" },
    { label: "Rankings", href: "/?section=rankings" },
  ];

  // Off-Season: Show both Free Agency and NFL Draft
  if (mode === "off-season") {
    return [
      ...base,
      { label: "Free Agency", href: "/?section=free-agency" },
      { label: "NFL Draft", href: "/?section=nfl-draft" },
      { label: "Fantasy Articles", href: "/?section=advice" },
      { label: "Fantasy Prep", href: "/?section=dfs" },
      { label: "Injuries", href: "/?section=injury" },
    ];
  }

  // Preseason: Fantasy draft prep focus
  if (mode === "preseason") {
    return [
      ...base,
      { label: "Draft Prep", href: "/?section=rankings" },
      { label: "Fantasy Articles", href: "/?section=advice" },
      { label: "Fantasy Prep", href: "/?section=dfs" },
      { label: "Injuries", href: "/?section=injury" },
    ];
  }

  // Regular season: Start/Sit + Waivers
  return [
    ...base,
    { label: "Start/Sit", href: "/?section=start-sit" },
    { label: "Waiver Wire", href: "/?section=waivers" },
    { label: "Fantasy Articles", href: "/?section=advice" },
    { label: "Fantasy Prep", href: "/?section=dfs" },
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
