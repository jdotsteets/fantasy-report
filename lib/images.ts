// lib/images.ts
const FALLBACK = "https://picsum.photos/800/450";

/**
 * Returns a "safe" image URL:
 * - Uses fallback if null/undefined/empty
 * - Handles bad/relative URLs gracefully
 */
export function getSafeImageUrl(src?: string | null): string {
  if (!src || !/^https?:\/\//i.test(src)) {
    return FALLBACK;
  }
  return src;
}

export { FALLBACK };
