// src/agent.ts
import { Topic, Draft, Platform } from "./types";
import { fetchFreshTopics } from "./inputs/topics";
import { renderDrafts } from "./writing/renderDrafts";
import { scheduleDrafts } from "./outputs/schedule";
import { selectBestHooks } from "./optimize/ab";

export async function runDailyLoop(): Promise<void> {
  const topics: Topic[] = await fetchFreshTopics({
    windowHours: 24,
    maxItems: 8,
  });

  const drafts: Draft[] = await renderDrafts(topics, {
    platforms: ["x", "reels", "tiktok", "shorts"],
    variantsPerTopic: 2,
  });

  const selected = selectBestHooks(drafts); // simple heuristic until metrics exist
  await scheduleDrafts(selected);
}
