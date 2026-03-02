// lib/hero.ts
export type HeroPayload = { title: string; href: string; src?: string; source: string } | null;

export async function fetchCurrentHero(): Promise<HeroPayload> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_SITE_ORIGIN ?? ""}/api/hero/current`, {
    method: "GET",
    cache: "no-store",
  });
  if (!res.ok) return null;
  const j: { hero: HeroPayload } = await res.json();
  return j.hero ?? null;
}
