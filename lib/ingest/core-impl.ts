// lib/ingest/core-impl.ts
import { fetchItemsForSource } from "@/lib/sources";
import { classifyArticle, looksLikePlayerPage } from "@/lib/classify";
import { upsertPlayerImage } from "@/lib/ingestPlayerImages";
import { findArticleImage } from "@/lib/scrape-image";
import { appendEvent, setProgress, finishJobSuccess, failJob } from "@/lib/jobs";
import { dbQuery } from "@/lib/db";

import { loadAdapters } from "./adapters";
import {
  toPlayerKey,
  looksUsableImage,
  normalizeImageForStorage,
  resolveFinalUrl,
  isLikelyDeadRedirect,
  inferWeekFromText,
  chooseCanonical,
  toDateOrNull,
} from "./normalize";
import {
  rowsOf,
  hostnameOf,
  getSource,
  getAllowedSources,
  upsertArticle,
  backfillArticleImage,
} from "./db";



export async function ingestSourceById(
  sourceId: number,
  opts?: { jobId?: string; limit?: number }
): Promise<IngestSummary> {
  const jobId = opts?.jobId;
  const limit = opts?.limit ?? 200;
  const log = mkLogger(jobId);
  const adapters = await loadAdapters();

  // Guard list (now includes 3136)
  const NON_NFL_GUARD_SOURCE_IDS = new Set<number>([6, 3135, 3136]);
  const looksClearlyNFL = (url: string, title?: string | null) => {
    const u = (url || "").toLowerCase();
    const t = (title || "").toLowerCase();
    const okUrl =
      u.includes("/nfl/") ||
      u.includes("nfl") ||
      u.includes("fantasy%20football") ||
      u.includes("fantasy-football") ||
      u.includes("fantasyfootball");
    const okTitle =
      t.includes("nfl") ||
      t.includes("fantasy football") ||
      t.includes("fantasy-football") ||
      t.includes("fantasyfootball");
    return okUrl || okTitle;
  };

  const src = await getSource(sourceId);
  if (!src) {
    await log.error("Unknown source", { sourceId });
    throw new Error(`Source ${sourceId} not found`);
  }

  await log.info("Ingest started", { sourceId, limit });
  if (jobId) {
    try { await setProgress(jobId, 0, limit); } catch {}
  }

  // 1) Candidate items
  await log.info("Fetching candidate items", { sourceId, limit });
  let items: Array<{ title: string; link: string; publishedAt?: Date | string | null }> = [];
  try {
    items = await fetchItemsForSource(sourceId, limit);
    await log.debug("Fetched feed items", { mode: "sources-index", count: items.length });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await log.error("Failed to fetch candidates", { sourceId, error: msg });
    items = [];
  }

  let inserted = 0, updated = 0, skipped = 0, processed = 0;

  for (const it of items) {
    processed++;
    if (jobId) {
      try { await setProgress(jobId, processed); } catch {}
    }

    const link = String(it?.link ?? "");
    const feedTitle = (it?.title ?? "").trim() || null;
    if (!link) {
      skipped++;
      await logIngest(src, "invalid_item", null, { detail: "empty link" });
      continue;
    }

    // Non-NFL guard
    if (NON_NFL_GUARD_SOURCE_IDS.has(src.id)) {
      if (!looksClearlyNFL(link, feedTitle)) {
        skipped++;
        await log.debug("non_nfl_guard: blocked", { sourceId: src.id, link, feedTitle });
        await logIngest(src, "blocked_by_filter", link, { title: feedTitle, detail: "non_nfl_guard" });
        continue;
      }
    }

    // Router / index checks
    await log.debug("Ingesting item", { link, feedTitle, sourceId });
    try {
      if (adapters.routeByUrl) {
        const routed = await adapters.routeByUrl(link);
        if (routed?.kind === "skip") {
          skipped++;
          await logIngest(src, "skip_router", link, { title: feedTitle, detail: routed?.reason ?? null });
          continue;
        }
        if (routed?.kind === "index") {
          skipped++;
          await logIngest(src, "skip_index", link, { title: feedTitle, detail: routed?.reason ?? null });
          continue;
        }
      } else if (isLikelyIndexOrNonArticle(link)) {
        skipped++;
        await logIngest(src, "skip_index", link, { title: feedTitle });
        continue;
      }
    } catch {
      /* best-effort router */
    }

const resolvedLink = await resolveFinalUrl(link);
const resolvedUrl  = new URL(resolvedLink);

if (isLikelyDeadRedirect(resolvedUrl)) {
  skipped++;
  await logIngest(src, "dead_redirect", link, { title: feedTitle, detail: resolvedLink });
  continue;
}

    // Normalize published_at
    let publishedAt: Date | null = null;
    const p = it?.publishedAt;
    if (p) {
      const d = new Date(p as string);
      if (!Number.isNaN(d.valueOf())) publishedAt = d;
    }

    // 2) Optional scrape enrich
    // Ensure canonical is *always* a string
    let canonical = chooseCanonical(null, link) ?? link;
    let chosenTitle = feedTitle;
    let chosenPlayers = extractPlayersFromTitleAndUrl(chosenTitle, canonical);

    try {
      if (adapters.scrapeArticle) {
        await log.debug("Calling scrapeArticle", { link });
        const scraped = await adapters.scrapeArticle(resolvedLink);
        await log.debug("Scrape result", {
          link,
          gotCanonical: !!scraped?.canonical_url,
          gotTitle: !!scraped?.title,
          gotImage: !!scraped?.image_url,
        });

        // Use the real page URL for canonical fallback
        const pageUrl = scraped?.url ?? resolvedLink;
        canonical = chooseCanonical(scraped?.canonical_url ?? null, resolvedLink) ?? resolvedLink;

        if (!publishedAt && scraped?.published_at) {
          const d2 = new Date(scraped.published_at as string);
          if (!Number.isNaN(d2.valueOf())) publishedAt = d2;
        }
        if (scraped?.title) chosenTitle = scraped.title;

        // Re-extract players now that canonical may have changed
        chosenPlayers = extractPlayersFromTitleAndUrl(chosenTitle, canonical);
        

        const scrapedImage = normalizeImageForStorage(scraped?.image_url ?? null);



        const klass = classifyArticle({ title: chosenTitle, url: canonical });
        const isPlayerPage = looksLikePlayerPage(resolvedLink, chosenTitle ?? undefined);

        const res = await upsertArticle({
          canonical_url: canonical,
          url: pageUrl,
          source_id: sourceId,
          title: chosenTitle,
          author: scraped?.author ?? null,
          published_at: publishedAt,
          image_url: scrapedImage,
          domain: hostnameOf(pageUrl) ?? null,
          sport: "nfl",
          topics: klass.topics,
          primary_topic: klass.primary,
          secondary_topic: klass.secondary,
          week: inferWeekFromText(chosenTitle, canonical),
          players: chosenPlayers,
          is_player_page: isPlayerPage,
        });

        const action = res.inserted ? "ok_insert" : "ok_update";
        if (res.inserted) inserted++; else updated++;
        await logIngest(src, action, canonical, { title: chosenTitle });

        await backfillAfterUpsert(
          canonical,
          klass.primary,
          (chosenPlayers && chosenPlayers.length === 1) ? chosenPlayers[0] : null
        );

        if (chosenPlayers && chosenPlayers.length === 1 && looksUsableImage(scrapedImage)) {
          const key = `nfl:name:${chosenPlayers[0].trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
          await upsertPlayerImage({ key, url: scrapedImage! });
        }

        continue; // finished this item
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await log.warn("Scrape failed; falling back to basic upsert", { link, error: msg });
      await logIngest(src, "parse_error", link, { title: feedTitle, detail: msg });
    }

    // 3) Fallback (no scraper)
    canonical = chooseCanonical(null, link) ?? link;
    const klass = classifyArticle({ title: chosenTitle, url: canonical });

    const players = extractPlayersFromTitleAndUrl(chosenTitle, canonical);
    const isPlayerPage = looksLikePlayerPage(link, feedTitle ?? undefined);

    const res = await upsertArticle({
      canonical_url: canonical,
      url: link,
      source_id: sourceId,
      title: feedTitle,
      author: null,
      published_at: publishedAt,
      image_url: null,
      domain: hostnameOf(link),
      sport: "nfl",
      topics: klass.topics,
      primary_topic: klass.primary,
      secondary_topic: klass.secondary,
      week: inferWeekFromText(chosenTitle, canonical),
      players,
      is_player_page: isPlayerPage,
    });

    const action = res.inserted ? "ok_insert" : "ok_update";
    if (res.inserted) inserted++; else updated++;
    await logIngest(src, action, canonical, { title: feedTitle });

    await backfillAfterUpsert(
      canonical,
      klass.primary,
      (players && players.length === 1) ? players[0] : null
    );
  }

  const summary = { total: items.length, inserted, updated, skipped };
  await log.info("Ingest summary", summary);
  return summary;

  async function backfillAfterUpsert(
    canon: string,
    _primaryTopic: string | null,
    possiblePlayerName?: string | null
  ) {
    const rs = await dbQuery<{ id: number; image_url: string | null }>(
      `SELECT id, image_url FROM articles WHERE canonical_url = $1`,
      [canon]
    );
    const row = rowsOf<{ id: number; image_url: string | null }>(rs)[0];
    if (!row) return;

    const best = await backfillArticleImage(row.id, canon, row.image_url);

    if (possiblePlayerName && looksUsableImage(best)) {
      const key = toPlayerKey(possiblePlayerName);
      await upsertPlayerImage({ key, url: best! });
    }
  }
}


export async function ingestAllAllowedSources(
  opts?: { jobId?: string; perSourceLimit?: number }
): Promise<void> {
  const jobId = opts?.jobId;
  const perSourceLimit = opts?.perSourceLimit ?? 50;
  const log = mkLogger(jobId);

  const sources = await getAllowedSources();
  await log.info("Starting ingest for allowed sources", { count: sources.length, perSourceLimit });

  if (jobId) {
    try {
      await setProgress(jobId, 0, sources.length);
    } catch {
      /* noop */
    }
  }
  let done = 0;
  for (const s of sources) {
    await log.info("Ingesting source", { name: s.name ?? `#${s.id}`, sourceId: s.id });
    try {
      await ingestSourceById(s.id, { jobId, limit: perSourceLimit });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await log.error("Source ingest failed", { sourceId: s.id, error: msg });
      await logIngest(s, "fetch_error", null, { detail: msg });
    }
    done++;
    if (jobId) {
      try {
        await setProgress(jobId, done);
      } catch {
        /* noop */
      }
    }
  }

  await log.info("All allowed sources finished", { count: sources.length });
}

export async function ingestAllSources(
  opts?: { jobId?: string; perSourceLimit?: number }
): Promise<void> {
  const jobId = opts?.jobId;
  const perSourceLimit = opts?.perSourceLimit ?? 50;
  const log = mkLogger(jobId);

  const res = await dbQuery<SourceRow>(
    `SELECT id, name, allowed, rss_url, homepage_url, scrape_selector
     FROM sources ORDER BY id ASC`,
    []
  );
  const rows = rowsOf<SourceRow>(res);

  await log.info("Starting ingest for all sources", { count: rows.length, perSourceLimit });

  if (jobId) {
    try {
      await setProgress(jobId, 0, rows.length);
    } catch {
      /* noop */
    }
  }
  let done = 0;
  for (const s of rows) {
    await log.info("Ingesting source", { name: s.name ?? `#${s.id}`, sourceId: s.id });
    try {
      await ingestSourceById(s.id, { jobId, limit: perSourceLimit });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await log.error("Source ingest failed", { sourceId: s.id, error: msg });
      await logIngest(s, "fetch_error", null, { detail: msg });
    }
    done++;
    if (jobId) {
      try {
        await setProgress(jobId, done);
      } catch {
        /* noop */
      }
    }
  }

  await log.info("All sources finished", { count: rows.length });
}


// ─────────────────────────────────────────────────────────────────────────────
// Job wrappers
// ─────────────────────────────────────────────────────────────────────────────
export async function runSingleSourceIngestWithJob(sourceId: number, limit = 200) {
  const { createJob } = await import("@/lib/jobs");
  const job = await createJob("ingest", { sourceId, limit });
  try {
    const summary = await ingestSourceById(sourceId, { jobId: job.id, limit });
    await finishJobSuccess(job.id, "success");
    return { jobId: job.id, summary };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await failJob(job.id, msg);
    throw new Error(msg);
  }
}

export async function runAllAllowedSourcesIngestWithJob(perSourceLimit = 50) {
  const { createJob } = await import("@/lib/jobs");
  const job = await createJob("ingest", { scope: "allowed", perSourceLimit });
  try {
    await ingestAllAllowedSources({ jobId: job.id, perSourceLimit });
    await finishJobSuccess(job.id, "success");
    return { jobId: job.id };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await failJob(job.id, msg);
    throw new Error(msg);
  }
}



export {
  ingestSourceById,
  ingestAllAllowedSources,
  ingestAllSources,
  runSingleSourceIngestWithJob,
  runAllAllowedSourcesIngestWithJob,
};
