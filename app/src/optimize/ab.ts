import type { Draft } from "../types";

/**
 * Pick one variant per (topicRef, platform) for now.
 * Later: use stored metrics to choose winners.
 */
export function selectBestHooks(drafts: Draft[]): Draft[] {
  const seen = new Set<string>();
  const selected: Draft[] = [];

  for (const d of drafts) {
    const key = `${d.topicRef}:${d.platform}`;
    if (!seen.has(key)) {
      seen.add(key);
      selected.push(d);
    }
  }
  return selected;
}
