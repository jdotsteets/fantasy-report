// lib/HomeData.ts
import {
  fetchSectionItems,
  ORDERED_SECTIONS,
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
  selectedSection?: SectionKey | null;
  limitNews?: number;
  limitRankings?: number;
  limitStartSit?: number;
  limitAdvice?: number;
  limitDFS?: number;
  limitWaivers?: number;
  limitInjuries?: number;
  limitDraft?: number;
  limitFreeAgency?: number;
  maxAgeHours?: number;
  limitHero?: number;
  includeHeroCandidates?: boolean;
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

function keyOf(r: SectionRow): string {
  return (r.canonical_url || r.url || String(r.id)).toLowerCase();
}

function providerKey(r: SectionRow): string {
  return (r.source ?? "unknown").toLowerCase();
}

const SECTION_TO_TOPIC: Record<SectionKey, string> = {
  "start-sit": "start-sit",
  "waiver-wire": "waiver-wire",
  injury: "injury",
  dfs: "dfs",
  rankings: "rankings",
  advice: "advice",
  news: "news",
  "nfl-draft": "nfl-draft",
  "free-agency": "free-agency",
};

function byRecencyDesc(a: SectionRow, b: SectionRow): number {
  const ad =
    a.published_at ? Date.parse(a.published_at) :
    a.discovered_at ? Date.parse(a.discovered_at) :
    0;

  const bd =
    b.published_at ? Date.parse(b.published_at) :
    b.discovered_at ? Date.parse(b.discovered_at) :
    0;

  return bd - ad;
}

function rankWithinSection(
  rows: SectionRow[],
  section: SectionKey,
  perProviderCap: number,
  firstWindow: number = 10,
): SectionRow[] {
  const topic = SECTION_TO_TOPIC[section];

  const primaries = rows
    .filter((r) => r.primary_topic === topic)
    .sort(byRecencyDesc);

  const secondaries = rows
    .filter(
      (r) =>
        r.primary_topic !== topic &&
        Array.isArray(r.topics) &&
        r.topics.includes(topic),
    )
    .sort(byRecencyDesc);

  const uncategorized = rows
    .filter(
      (r) =>
        r.primary_topic !== topic &&
        (!Array.isArray(r.topics) || !r.topics.includes(topic)),
    )
    .sort(byRecencyDesc);

  const firstBlock: SectionRow[] = [];
  const overflowPrimaries: SectionRow[] = [];

  for (const r of primaries) {
    const last = firstBlock[firstBlock.length - 1];
    if (
      firstBlock.length < firstWindow &&
      (!last || providerKey(last) !== providerKey(r))
    ) {
      firstBlock.push(r);
    } else {
      overflowPrimaries.push(r);
    }
  }

  const combined: SectionRow[] = [
    ...firstBlock,
    ...overflowPrimaries,
    ...secondaries,
    ...uncategorized,
  ];

  if (perProviderCap > 0) {
    const counts = new Map<string, number>();
    const capped: SectionRow[] = [];

    for (const r of combined) {
      const pk = providerKey(r);
      const n = counts.get(pk) ?? 0;

      if (n < perProviderCap) {
        capped.push(r);
        counts.set(pk, n + 1);
      }
    }

    return capped;
  }

  return combined;
}

function dedupeAcrossSectionsTopicAware(
  sections: Record<SectionKey, SectionRow[]>,
): Record<SectionKey, SectionRow[]> {
  const seenOwned = new Set<string>();
  const seenAny = new Set<string>();

  const out: Record<SectionKey, SectionRow[]> = {
    "start-sit": [],
    "waiver-wire": [],
    injury: [],
    dfs: [],
    rankings: [],
    advice: [],
    news: [],
    "nfl-draft": [],
    "free-agency": [],
  };

  for (const key of ORDERED_SECTIONS) {
    const topic = SECTION_TO_TOPIC[key];
    const next: SectionRow[] = [];

    for (const row of sections[key] || []) {
      const k = keyOf(row);

      if (seenOwned.has(k)) continue;
      if (seenAny.has(`${key}:${k}`)) continue;

      seenAny.add(`${key}:${k}`);
      next.push(row);

      if (row.primary_topic === topic) {
        seenOwned.add(k);
      }
    }

    out[key] = next;
  }

  return out;
}

function toDebugRow(row: SectionRow) {
  return {
    id: row.id,
    title: row.title,
    source: row.source,
    primary_topic: row.primary_topic ?? null,
    topics: row.topics ?? null,
    published_at: row.published_at ?? null,
    discovered_at: row.discovered_at ?? null,
    canonical_url: row.canonical_url ?? null,
  };
}

function logSectionSnapshot(label: string, rows: SectionRow[], max: number = 5): void {
  console.log(`[HomeData] ${label} count=${rows.length}`);
  console.log(
    `[HomeData] ${label} sample=`,
    rows.slice(0, max).map(toDebugRow),
  );
}

export async function getHomeData(
  opts: HomeDataOptions = {},
): Promise<{
  items: {
    latest: SectionRow[];
    mockDraft: SectionRow[];
    draftBuzz: SectionRow[];
    rankings: SectionRow[];
    startSit: SectionRow[];
    advice: SectionRow[];
    dfs: SectionRow[];
    waivers: SectionRow[];
    injury: SectionRow[];
    injuries: SectionRow[];
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

  const sport = (opts.sport ?? "").toLowerCase().trim() || undefined;
  const provider =
    (opts.provider ?? "").toLowerCase().replace(/^www\./, "").trim() || undefined;
  const sourceId =
    typeof opts.sourceId === "number" ? opts.sourceId : undefined;

  const limits = {
    news: clamp(opts.limitNews ?? baseLimit, 1, 150),
    rankings: clamp(opts.limitRankings ?? baseLimit, 1, 150),
    startSit: clamp(opts.limitStartSit ?? baseLimit, 1, 150),
    advice: clamp(opts.limitAdvice ?? baseLimit, 1, 150),
    dfs: clamp(opts.limitDFS ?? baseLimit, 1, 150),
    waivers: clamp(opts.limitWaivers ?? baseLimit, 1, 150),
    injuries: clamp(opts.limitInjuries ?? baseLimit, 1, 150),
  };

  const includeHeroCandidates = opts.includeHeroCandidates ?? true;

  const shared = {
    days,
    perProviderCap,
    sport,
    sourceId,
    provider,
    staticMode: "exclude" as const,
  };

  console.log("[HomeData] getHomeData opts=", {
    days,
    week,
    sport,
    sourceId: sourceId ?? null,
    provider: provider ?? null,
    perProviderCap,
    selectedSection: opts.selectedSection ?? null,
    limits,
    includeHeroCandidates,
  });

  const selected = opts.selectedSection ?? null;

  if (selected) {
    const dbKey: SectionKey =
      selected === "waiver-wire" ? "waiver-wire" :
      selected === "start-sit" ? "start-sit" :
      selected === "rankings" ? "rankings" :
      selected === "dfs" ? "dfs" :
      selected === "advice" ? "advice" :
      selected === "injury" ? "injury" :
      "news";

    const single = await fetchSectionItems({
      key: dbKey,
      limit:
        dbKey === "news" ? limits.news :
        dbKey === "rankings" ? limits.rankings :
        dbKey === "start-sit" ? limits.startSit :
        dbKey === "advice" ? limits.advice :
        dbKey === "dfs" ? limits.dfs :
        dbKey === "waiver-wire" ? limits.waivers :
        limits.injuries,
      ...(dbKey === "waiver-wire" ? { week } : {}),
      ...shared,
    });

    logSectionSnapshot(`raw:${dbKey}`, single);

    const ranked = rankWithinSection(single, dbKey, perProviderCap);

    logSectionSnapshot(`ranked:${dbKey}`, ranked);

    const heroLimit = clamp(opts.limitHero ?? 24, 1, 100);
    const heroCandidates = includeHeroCandidates
      ? uniqById(ranked).slice(0, heroLimit)
      : [];

    logSectionSnapshot("heroCandidates:selected-mode", heroCandidates);

    const empty: SectionRow[] = [];

    return {
      items: {
        latest: dbKey === "news" ? ranked : empty,
        mockDraft: empty,
        draftBuzz: empty,
        rankings: dbKey === "rankings" ? ranked : empty,
        startSit: dbKey === "start-sit" ? ranked : empty,
        advice: dbKey === "advice" ? ranked : empty,
        dfs: dbKey === "dfs" ? ranked : empty,
        waivers: dbKey === "waiver-wire" ? ranked : empty,
        injury: dbKey === "injury" ? ranked : empty,
        injuries: dbKey === "injury" ? ranked : empty,
        heroCandidates,
      },
    };
  }

  const [news, rankings, startSit, advice, dfs, waivers, injury, mockDraft, draftBuzz] = await Promise.all([
    fetchSectionItems({ key: "news", limit: limits.news, maxAgeHours: opts.maxAgeHours, ...shared }),
    fetchSectionItems({ key: "rankings", limit: limits.rankings, ...shared }),
    fetchSectionItems({ key: "start-sit", limit: limits.startSit, ...shared }),
    fetchSectionItems({ key: "advice", limit: limits.advice, ...shared }),
    fetchSectionItems({ key: "dfs", limit: limits.dfs, ...shared }),
    fetchSectionItems({ key: "waiver-wire", limit: limits.waivers, week, ...shared }),
    fetchSectionItems({ key: "injury", limit: limits.injuries, ...shared }),
    fetchSectionItems({
      key: "",
      sport,
      days: 45,
      limit: 50,
      where: "(primary_topic = 'mock-draft' OR 'mock-draft' = ANY(topics))",
      staticMode: "exclude",
    }),
    fetchSectionItems({
      key: "",
      sport,
      days: 21,
      limit: 50,
      where: "(primary_topic = 'draft-buzz' OR 'draft-buzz' = ANY(topics))",
      staticMode: "exclude",
    }),
  ]);

  logSectionSnapshot("raw:news", news);
  logSectionSnapshot("raw:rankings", rankings);
  logSectionSnapshot("raw:start-sit", startSit);
  logSectionSnapshot("raw:advice", advice);
  logSectionSnapshot("raw:dfs", dfs);
  logSectionSnapshot("raw:waiver-wire", waivers);
  logSectionSnapshot("raw:injury", injury);

  const deduped = dedupeAcrossSectionsTopicAware({
    "start-sit": startSit,
    "waiver-wire": waivers,
    injury,
    dfs,
    rankings,
    advice,
    news,
    "nfl-draft": [],
    "free-agency": [],
  });

  const startSitOut = rankWithinSection(
    deduped["start-sit"],
    "start-sit",
    perProviderCap,
  );
  const waiversOut = rankWithinSection(
    deduped["waiver-wire"],
    "waiver-wire",
    perProviderCap,
  );
  const injuryOut = rankWithinSection(
    deduped.injury,
    "injury",
    perProviderCap,
  );
  const dfsOut = rankWithinSection(
    deduped.dfs,
    "dfs",
    perProviderCap,
  );
  const rankingsOut = rankWithinSection(
    deduped.rankings,
    "rankings",
    perProviderCap,
  );
  const adviceOut = rankWithinSection(
    deduped.advice,
    "advice",
    perProviderCap,
  );
  const newsOut = rankWithinSection(
    deduped.news,
    "news",
    perProviderCap,
  );

  logSectionSnapshot("final:news", newsOut);
  logSectionSnapshot("final:rankings", rankingsOut);
  logSectionSnapshot("final:start-sit", startSitOut);
  logSectionSnapshot("final:advice", adviceOut);
  logSectionSnapshot("final:dfs", dfsOut);
  logSectionSnapshot("final:waiver-wire", waiversOut);
  logSectionSnapshot("final:injury", injuryOut);

  const heroLimit = clamp(opts.limitHero ?? 24, 1, 100);

  const heroCandidates = includeHeroCandidates
    ? uniqById([
        ...newsOut,
        ...rankingsOut,
        ...startSitOut,
        ...adviceOut,
        ...dfsOut,
        ...waiversOut,
        ...injuryOut,
      ]).slice(0, heroLimit)
    : [];

  logSectionSnapshot("heroCandidates:full-mode", heroCandidates);

  return {
    items: {
      latest: newsOut,
        mockDraft,
        draftBuzz,
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