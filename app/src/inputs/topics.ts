import { dbQueryRows } from "@/lib/db";
import type { Topic } from "../types";

type Row = {
  id: string; // bigints often come back as strings
  title: string;
  url: string | null;
  canonical_url: string | null;
  source_name: string | null;
  published_at: string | null;
  discovered_at: string | null;
  primary_topic: string | null;
  static_type: string | null;
  is_player_page: boolean | null;
  week: number | null;
  sport: string | null;
  domain: string | null;
};

export async function fetchFreshTopics(opts: {
  windowHours: number;
  maxItems: number;
}): Promise<Topic[]> {
  const rows = await dbQueryRows<Row>(
    `
    select
      a.id::text,
      a.title,
      a.url,
      a.canonical_url,
      s.name as source_name,
      a.published_at,
      a.discovered_at,
      a.primary_topic,
      a.static_type,
      a.is_player_page,
      a.week,
      a.sport,
      a.domain
    from articles a
    left join sources s on s.id = a.source_id
    where coalesce(a.published_at, a.discovered_at) >= now() - ($1 || ' hours')::interval
      and (a.sport is null or a.sport = 'nfl')
      and coalesce(a.is_player_page, false) = false
      and a.title is not null and a.title <> ''
    order by coalesce(a.published_at, a.discovered_at) desc
    limit $2
    `,
    [opts.windowHours, opts.maxItems]
  );

  return rows.map((r) => {
    const href = r.canonical_url ?? r.url ?? "";
    const angle = inferAngle(r.primary_topic, r.static_type);
    return {
      id: r.id,
      title: r.title,
      url: href,
      source: r.source_name ?? r.domain ?? "unknown",
      publishedAt: r.published_at ?? r.discovered_at ?? new Date().toISOString(),
      primaryTopic: r.primary_topic,
      staticType: r.static_type,
      isPlayerPage: r.is_player_page,
      week: r.week,
      sport: r.sport,
      stat: undefined,
      angle
    };
  });
}

function inferAngle(primary: string | null, staticType: string | null): string {
  const p = (primary ?? "").toLowerCase();
  const s = (staticType ?? "").toLowerCase();
  if (p.includes("waiver") || s === "waiver-wire") return "waiver priority";
  if (p.includes("start") || p.includes("sit") || s === "start-sit") return "start/sit call";
  if (p.includes("injury")) return "injury contingency";
  if (p.includes("dfs") || s === "dfs") return "dfs leverage";
  if (p.includes("rank")) return "rankings movement";
  return "news reaction";
}
