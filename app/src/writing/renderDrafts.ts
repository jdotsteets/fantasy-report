import type { Draft, Platform, Topic } from "../types";

export async function renderDrafts(
  topics: Topic[],
  cfg: { platforms: Platform[]; variantsPerTopic: number }
): Promise<Draft[]> {
  const drafts: Draft[] = [];

  for (const t of topics) {
    for (const p of cfg.platforms) {
      for (let i = 0; i < cfg.variantsPerTopic; i += 1) {
        const hook = makeHook(t, i);
        const body = makeBody(t, p);

        drafts.push({
          id: `${t.id}:${p}:v${i + 1}`,
          platform: p,
          hook,
          body,
          cta: platformCta(p),
          mediaPath: undefined,
          link: t.url,
          status: "draft",
          scheduledFor: undefined,
          topicRef: t.id,
        });
      }
    }
  }
  return drafts;
}

function makeHook(t: Topic, variant: number): string {
  const base = t.title.replace(/\s+/g, " ").trim();
  const prefix = variant % 2 === 0 ? "Stop overreacting:" : "Quiet breakout:";
  return `${prefix} ${truncate(base, 70)}`;
}

function makeBody(t: Topic, platform: Platform): string {
  const stat = t.stat ? ` ${t.stat}.` : "";
  const takeaway = t.angle ? ` ${t.angle}.` : "";
  const linkNote =
    platform === "x" || platform === "threads"
      ? ` Full breakdown: ${t.url}`
      : " Save for waivers → thefantasyreport.com";
  return `${stat}${takeaway}${linkNote}`.trim();
}

function platformCta(platform: Platform): string | undefined {
  if (platform === "x" || platform === "threads") return undefined;
  return "More at thefantasyreport.com";
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
