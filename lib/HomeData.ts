// lib/HomeData.ts
import {
  fetchSectionItems,
  ORDERED_SECTIONS,          // ["start-sit","waiver-wire","injury","dfs","rankings","advice","news"]
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

/** stable key used to identify duplicates across sections */
function keyOf(r: SectionRow): string {
  return (r.canonical_url || r.url || String(r.id)).toLowerCase();
}

/** remove duplicates across sections based on ORDERED_SECTIONS priority */
function dedupeAcrossSections(sections: Record<SectionKey, SectionRow[]>): Record<SectionKey, SectionRow[]> {
  const seen = new Set<string>();
  const out: Record<SectionKey, SectionRow[]> = {
    "start-sit": [],
    "waiver-wire": [],
    "injury": [],
    "dfs": [],
    "rankings": [],
    "advice": [],
    "news": [],
  };

  for (const key of ORDERED_SECTIONS) {
    const next: SectionRow[] = [];
    for (const row of sections[key] || []) {
      const k = keyOf(row);
      if (seen.has(k)) continue;
      seen.add(k);
      next.push(row);
    }
    out[key] = next;
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
    injury: SectionRow[];      // back-compat
    injuries: SectionRow[];    // required by page.tsx
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

  const sport    = (opts.sport ?? "").toLowerCase().trim() || undefined;
  const provider = (opts.provider ?? "").toLowerCase().replace(/^www\./, "").trim() || undefined;
  const sourceId = typeof opts.sourceId === "number" ? opts.sourceId : undefined;

  const limits = {
    news:     clamp(opts.limitNews ?? baseLimit, 1, 50),
    rankings: clamp(opts.limitRankings ?? baseLimit, 1, 50),
    startSit: clamp(opts.limitStartSit ?? baseLimit, 1, 50),
    advice:   clamp(opts.limitAdvice ?? baseLimit, 1, 50),
    dfs:      clamp(opts.limitDFS ?? baseLimit, 1, 50),
    waivers:  clamp(opts.limitWaivers ?? baseLimit, 1, 50),
    injuries: clamp(opts.limitInjuries ?? baseLimit, 1, 50),
  };

  // default: exclude static items everywhere
  const shared = { days, perProviderCap, sport, sourceId, provider, staticMode: "exclude" as const };

  // Fetch all sections in parallel
  const [news, rankings, startSit, advice, dfs, waivers, injury] = await Promise.all([
    fetchSectionItems({ key: "news",        limit: limits.news,      ...shared }),
    fetchSectionItems({ key: "rankings",    limit: limits.rankings,  ...shared }),
    fetchSectionItems({ key: "start-sit",   limit: limits.startSit,  ...shared }),
    fetchSectionItems({ key: "advice",      limit: limits.advice,    ...shared }),
    fetchSectionItems({ key: "dfs",         limit: limits.dfs,       ...shared }),
    fetchSectionItems({ key: "waiver-wire", limit: limits.waivers, week, ...shared }),
    fetchSectionItems({ key: "injury",      limit: limits.injuries,  ...shared }),
  ]);

  // Cross-section de-dupe by priority
  const deduped = dedupeAcrossSections({
    "start-sit":   startSit,
    "waiver-wire": waivers,
    "injury":      injury,
    "dfs":         dfs,
    "rankings":    rankings,
    "advice":      advice,
    "news":        news,
  });

  // Map back to UI names
  const startSitOut = deduped["start-sit"];
  const waiversOut  = deduped["waiver-wire"];
  const injuryOut   = deduped["injury"];
  const dfsOut      = deduped["dfs"];
  const rankingsOut = deduped["rankings"];
  const adviceOut   = deduped["advice"];
  const newsOut     = deduped["news"];

  // Hero pool (deduped by id) and cap
  const heroLimit = clamp(opts.limitHero ?? 24, 1, 100);
  const heroCandidates = uniqById([
    ...newsOut,
    ...rankingsOut,
    ...startSitOut,
    ...adviceOut,
    ...dfsOut,
    ...waiversOut,
    ...injuryOut,
  ]).slice(0, heroLimit);

  return {
    items: {
      latest: newsOut,
      rankings: rankingsOut,
      startSit: startSitOut,
      advice: adviceOut,
      dfs: dfsOut,
      waivers: waiversOut,
      injury: injuryOut,
      injuries: injuryOut,
      heroCandidates,
    },
  };
}

// Optional single section helper (preserves your staticMode override support)
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
    staticMode?: "exclude" | "only" | "any";
    staticType?: string | null;
  } = {},
): Promise<SectionRow[]> {
  return fetchSectionItems({
    key,
    staticMode: opts.staticMode ?? "exclude",
    ...opts,
  });
}
