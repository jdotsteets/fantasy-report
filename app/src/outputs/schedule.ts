import type { Draft } from "../types";

/**
 * Stub scheduler: replace with Buffer/Later/native API calls.
 * Keeps strict types and allows the agent loop to run now.
 */
export async function scheduleDrafts(drafts: Draft[]): Promise<void> {
  // For now, just log which drafts would be scheduled.
  // Wire up real scheduling later.
  // eslint-disable-next-line no-console
  console.log(
    "Scheduling drafts:",
    drafts.map((d) => ({ id: d.id, platform: d.platform, hook: d.hook }))
  );
}
