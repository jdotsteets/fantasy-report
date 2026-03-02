// components/FantasyLinks.tsx
import { dbQuery } from "@/lib/db";
import Image from "next/image";

type SourceRow = {
  id: number;
  name: string;
  homepage_url: string | null;
  category: string | null;
  allowed: boolean | null;
};

function norm(s: string | null | undefined) {
  return (s ?? "").toLowerCase().trim();
}

function catPriority(raw: string | null) {
  const c = norm(raw);
  // "Fantasy News" first
  if (c === "fantasy news") return 0;
  return 1;
}

function domainFromUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function faviconUrl(domain: string | null): string | null {
  return domain ? `https://icons.duckduckgo.com/ip3/${domain}.ico` : null;
}

export default async function FantasyLinks() {
  const { rows } = await dbQuery<SourceRow>(
    `
      select id, name, homepage_url, category, allowed
      from sources
      where homepage_url is not null
      order by name asc
    `
  );

  // 1) Filter out team sites and any disallowed rows
  const filtered = rows.filter((r) => {
    const c = norm(r.category);
    const isTeam =
      c === "team" ||
      c === "team site" ||
      c === "team-site" ||
      c === "team sites" ||
      c.includes("team");
    const allowed = r.allowed !== false; // treat null as allowed
    return allowed && !isTeam;
  });

  // 2) Sort: Fantasy News category first, then by category, then name
  filtered.sort((a, b) => {
    const ap = catPriority(a.category);
    const bp = catPriority(b.category);
    if (ap !== bp) return ap - bp;

    const ac = norm(a.category);
    const bc = norm(b.category);
    if (ac !== bc) return ac.localeCompare(bc);

    return a.name.localeCompare(b.name);
  });

  return (
    <ul className="space-y-2">
      {filtered.map((r) => {
        const domain = domainFromUrl(r.homepage_url);
        const ico = faviconUrl(domain);

        return (
          <li key={r.id} className="flex items-start gap-2">
            {ico ? (
              <Image
                src={ico}
                alt=""
                width={16}
                height={16}
                unoptimized
                className="mt-[2px] h-4 w-4 shrink-0 rounded"
              />
            ) : (
              <span className="mt-[4px] inline-block h-2 w-2 shrink-0 rounded-full bg-zinc-300" />
            )}

            <div className="min-w-0">
              <a
                href={r.homepage_url ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="text-[13px] leading-tight text-black no-underline hover:text-emerald-700 visited:text-emerald-800"
                title={r.name}
              >
                {r.name}
              </a>
              {r.category ? (
                <span className="ml-2 align-middle rounded-full bg-zinc-100 px-2 py-[2px] text-[11px] text-zinc-600">
                  {r.category}
                </span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
