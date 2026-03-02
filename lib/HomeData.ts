// lib/HomeData.ts
import {
  fetchSectionItems,
  ORDERED_SECTIONS, // ["start-sit","waiver-wire","injury","dfs","rankings","advice","news"]
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

  /** NEW: if provided, fetch only this section (big perf win) */
  selectedSection?: SectionKey | null;

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

  /** NEW: optionally skip hero pool work */
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

/** stable key used to identify duplicates across sections */
function keyOf(r: SectionRow): string {
  return (r.canonical_url || r.url || String(r.id)).toLowerCase();
}

/** normalize a provider key for balancing/capping (fallback to source name) */
function providerKey(r: SectionRow): string {
  // SectionRow doesn’t expose provider_key; use lowercased source name as a stable proxy
  return (r.source ?? "unknown").toLowerCase();
}

/* ───────────────────────── Section/topic helpers ───────────────────────── */

const SECTION_TO_TOPIC: Record<SectionKey, string> = {
  "start-sit": "start-sit",
  "waiver-wire": "waiver-wire",
  "injury": "injury",
  "dfs": "dfs",
  "rankings": "rankings",
  "advice": "advice",
  "news": "news",
};

/** newest-first date compare */
function byRecencyDesc(a: SectionRow, b: SectionRow): number {
  const ad = a.published_at ? Date.parse(a.published_at) : 0;
  const bd = b.published_at ? Date.parse(b.published_at) : 0;
  return bd - ad;
}

/**
 * Rank a single section:
 *  1. all primary_topic matches (recency desc)
 *  1b. avoid back-to-back same provider across the first `firstWindow`
 *  1c. enforce per-provider cap across the entire list
 *  2. backfill with secondary/topic matches (recency desc)
 */
function rankWithinSection(
  rows: SectionRow[],
  section: SectionKey,
  perProviderCap: number,
  firstWindow: number = 10
): SectionRow[] {
  const topic = SECTION_TO_TOPIC[section];

  const primaries = rows.filter(r => r.primary_topic === topic).sort(byRecencyDesc);
  const secondaries = rows
    .filter(r => r.primary_topic !== topic && Array.isArray(r.topics) && r.topics.includes(topic))
    .sort(byRecencyDesc);

  // Interleave primaries to avoid back-to-back same provider in the first window
  const firstBlock: SectionRow[] = [];
  const overflowPrimaries: SectionRow[] = [];

  for (const r of primaries) {
    const last = firstBlock[firstBlock.length - 1];
    if (firstBlock.length < firstWindow && (!last || providerKey(last) !== providerKey(r))) {
      firstBlock.push(r);
    } else {
      overflowPrimaries.push(r);
    }
  }

  // Combine: balanced primaries (first window) + remaining primaries + secondaries as backfill
  const combined: SectionRow[] = firstBlock.concat(overflowPrimaries, secondaries);

  // Enforce per-provider cap if provided (>0)
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

/**
 * Topic-aware cross-section de-dupe.
 * Earlier sections only “own” a URL if its primary_topic actually matches that section’s topic.
 * We still suppress exact-duplicate URLs already owned by a previous section.
 */
function dedupeAcrossSectionsTopicAware(
  sections: Record<SectionKey, SectionRow[]>
): Record<SectionKey, SectionRow[]> {
  const seenOwned = new Set<string>(); // URLs owned by a true-primary earlier section
  const seenAny = new Set<string>();   // any URL emitted (prevents literal duplicates within the same section)
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
    const topic = SECTION_TO_TOPIC[key];
    const next: SectionRow[] = [];

    for (const row of sections[key] || []) {
      const k = keyOf(row);

      // If an earlier section truly owned this URL (primary match), suppress it here.
      if (seenOwned.has(k)) continue;

      // Prevent exact duplicates within the same section pass
      if (seenAny.has(`${key}:${k}`)) continue;
      seenAny.add(`${key}:${k}`);

      // Emit it
      next.push(row);

      // If this section is the row's primary, mark as owned → later sections will suppress it
      if (row.primary_topic === topic) {
        seenOwned.add(k);
      }
    }
    out[key] = next;
  }

  return out;
}

/* ───────────────────────── Main API ───────────────────────── */

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

  // NOTE: this is a *global per-section* cap used in ranking phase.
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
    news:     clamp(opts.limitNews ?? baseLimit, 1, 150),
    rankings: clamp(opts.limitRankings ?? baseLimit, 1, 150),
    startSit: clamp(opts.limitStartSit ?? baseLimit, 1, 150),
    advice:   clamp(opts.limitAdvice ?? baseLimit, 1, 150),
    dfs:      clamp(opts.limitDFS ?? baseLimit, 1, 150),
    waivers:  clamp(opts.limitWaivers ?? baseLimit, 1, 150),
    injuries: clamp(opts.limitInjuries ?? baseLimit, 1, 150),
  };

  const includeHeroCandidates = opts.includeHeroCandidates ?? true;

  // default: exclude static items everywhere
  const shared = {
    days,
    perProviderCap,
    sport,
    sourceId,
    provider,
    staticMode: "exclude" as const,
  };

  // ───────────────────────── BIG WIN: single-section mode ─────────────────────────
  const selected = opts.selectedSection ?? null;
  if (selected) {
    // Map UI keys -> DB section keys
    const dbKey: SectionKey =
      selected === "waiver-wire" ? "waiver-wire" :
      selected === "start-sit"   ? "start-sit"   :
      selected === "rankings"    ? "rankings"    :
      selected === "dfs"         ? "dfs"         :
      selected === "advice"      ? "advice"      :
      selected === "injury"      ? "injury"      :
      "news";

    // Pull only the requested section.
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

    const ranked = rankWithinSection(single, dbKey, perProviderCap);

    // Optional: small hero pool derived from the same section (cheap)
    const heroLimit = clamp(opts.limitHero ?? 24, 1, 100);
    const heroCandidates = includeHeroCandidates ? uniqById(ranked).slice(0, heroLimit) : [];

    // Return the same shape, but only populate the chosen section.
    const empty: SectionRow[] = [];
    return {
      items: {
        latest:   dbKey === "news"       ? ranked : empty,
        rankings: dbKey === "rankings"   ? ranked : empty,
        startSit: dbKey === "start-sit"  ? ranked : empty,
        advice:   dbKey === "advice"     ? ranked : empty,
        dfs:      dbKey === "dfs"        ? ranked : empty,
        waivers:  dbKey === "waiver-wire"? ranked : empty,
        injury:   dbKey === "injury"     ? ranked : empty,
        injuries: dbKey === "injury"     ? ranked : empty,
        heroCandidates,
      },
    };
  }

  // ───────────────────────── Full homepage mode (all sections) ─────────────────────────
  const [news, rankings, startSit, advice, dfs, waivers, injury] = await Promise.all([
    fetchSectionItems({ key: "news",        limit: limits.news,      ...shared }),
    fetchSectionItems({ key: "rankings",    limit: limits.rankings,  ...shared }),
    fetchSectionItems({ key: "start-sit",   limit: limits.startSit,  ...shared }),
    fetchSectionItems({ key: "advice",      limit: limits.advice,    ...shared }),
    fetchSectionItems({ key: "dfs",         limit: limits.dfs,       ...shared }),
    fetchSectionItems({ key: "waiver-wire", limit: limits.waivers, week, ...shared }),
    fetchSectionItems({ key: "injury",      limit: limits.injuries,  ...shared }),
  ]);

  const deduped = dedupeAcrossSectionsTopicAware({
    "start-sit":   startSit,
    "waiver-wire": waivers,
    "injury":      injury,
    "dfs":         dfs,
    "rankings":    rankings,
    "advice":      advice,
    "news":        news,
  });

  const startSitOut = rankWithinSection(deduped["start-sit"], "start-sit", perProviderCap);
  const waiversOut  = rankWithinSection(deduped["waiver-wire"], "waiver-wire", perProviderCap);
  const injuryOut   = rankWithinSection(deduped["injury"], "injury", perProviderCap);
  const dfsOut      = rankWithinSection(deduped["dfs"], "dfs", perProviderCap);
  const rankingsOut = rankWithinSection(deduped["rankings"], "rankings", perProviderCap);
  const adviceOut   = rankWithinSection(deduped["advice"], "advice", perProviderCap);
  const newsOut     = rankWithinSection(deduped["news"], "news", perProviderCap);

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

/* ───────────────────────── Optional single-section helper ───────────────────────── */

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