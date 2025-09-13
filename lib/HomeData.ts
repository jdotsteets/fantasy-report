// lib/HomeData.ts
import {
  fetchSectionItems,
  type SectionKey,
  type SectionRow,
} from "@/lib/sectionQuery";

export type DbRow = SectionRow;

export type HomeDataOptions = {
  days?: number;
  week?: number | null;
  perProviderCap?: number;
  limitPerSection?: number;
  sport?: string;
  sourceId?: number;
  provider?: string;
  // per-section limit overrides
  limitNews?: number;
  limitRankings?: number;
  limitStartSit?: number;
  limitAdvice?: number;
  limitDFS?: number;
  limitWaivers?: number;
  limitInjuries?: number;
  // hero pool cap
  limitHero?: number;
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function uniqById(rows: SectionRow[]): SectionRow[] {
  const seen = new Set<number>();
  const out: SectionRow[] = [];
  for (const r of rows) {
    if (!seen.has(r.id)) {
      seen.add(r.id);
      out.push(r);
    }
  }
  return out;
}

export async function getHomeData(
  opts: HomeDataOptions = {},
): Promise<{
  items: {
    latest: SectionRow[];
    rankings: SectionRow[];
    startSit: SectionRow[];
    advice: SectionRow[];
    dfs: SectionRow[];
    waivers: SectionRow[];
    injury: SectionRow[];      // keep for back-compat
    injuries: SectionRow[];    // required by page.tsx HomePayload
    heroCandidates: SectionRow[];
  };
}> {
  const baseLimit = clamp(opts.limitPerSection ?? 12, 1, 50);
  const perProviderCap = clamp(
    opts.perProviderCap ?? Math.max(1, Math.floor(baseLimit / 3)),
    1,
    10,
  );
  const days = clamp(opts.days ?? 45, 1, 365);
  const week = typeof opts.week === "number" ? clamp(opts.week, 0, 30) : null;

  const sport =
    (opts.sport ?? "").toLowerCase().trim() || undefined;
  const provider =
    (opts.provider ?? "").toLowerCase().replace(/^www\./, "").trim() || undefined;
  const sourceId =
    typeof opts.sourceId === "number" ? opts.sourceId : undefined;

  const limits = {
    news: clamp(opts.limitNews ?? baseLimit, 1, 50),
    rankings: clamp(opts.limitRankings ?? baseLimit, 1, 50),
    startSit: clamp(opts.limitStartSit ?? baseLimit, 1, 50),
    advice: clamp(opts.limitAdvice ?? baseLimit, 1, 50),
    dfs: clamp(opts.limitDFS ?? baseLimit, 1, 50),
    waivers: clamp(opts.limitWaivers ?? baseLimit, 1, 50),
    injuries: clamp(opts.limitInjuries ?? baseLimit, 1, 50),
  };

  const shared = { days, week, perProviderCap, sport, sourceId, provider };

  // Fetch all sections in parallel using the shared (provider-interleaved, primary-topic) query
  const [news, rankings, startSit, advice, dfs, waivers, injury] = await Promise.all([
    fetchSectionItems({ key: "news",        limit: limits.news,      ...shared }),
    fetchSectionItems({ key: "rankings",    limit: limits.rankings,  ...shared }),
    fetchSectionItems({ key: "start-sit",   limit: limits.startSit,  ...shared }),
    fetchSectionItems({ key: "advice",      limit: limits.advice,    ...shared }),
    fetchSectionItems({ key: "dfs",         limit: limits.dfs,       ...shared }),
    fetchSectionItems({ key: "waiver-wire", limit: limits.waivers,   ...shared }),
    fetchSectionItems({ key: "injury",      limit: limits.injuries,  ...shared }),
  ]);

  // Build hero pool (deduped) and cap
  const heroLimit = clamp(opts.limitHero ?? 24, 1, 100);
  const heroCandidates = uniqById([
    ...news,
    ...rankings,
    ...startSit,
    ...advice,
    ...dfs,
    ...waivers,
    ...injury,
  ]).slice(0, heroLimit);

  return {
    items: {
      latest: news,
      rankings,
      startSit,
      advice,
      dfs,
      waivers,
      injury,            // singular (back-compat)
      injuries: injury,  // plural alias (required by HomePayload)
      heroCandidates,
    },
  };
}

// Optional single section helper
export async function getSectionItems(
  key: SectionKey,
  opts: {
    limit?: number;
    offset?: number;
    days?: number;
    week?: number | null;
    perProviderCap?: number;
    sport?: string;
    sourceId?: number;
    provider?: string;
  } = {},
): Promise<SectionRow[]> {
  return fetchSectionItems({ key, ...opts });
}
