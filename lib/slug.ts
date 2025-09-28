// lib/slug.ts
export function slugify(input: string, suffix?: string): string {
  const base = input
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
  return suffix ? `${base}-${suffix}` : base;
}