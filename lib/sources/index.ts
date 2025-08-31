// lib/sources/index.ts
import type { SourceAdapter } from "./types";
import { scrapeIndex, enrichArticle } from "./fantasylife";

const fantasylifeAdapter: SourceAdapter = {
  getIndex: (pages?: number) => scrapeIndex(pages),
  getArticle: (url: string) => enrichArticle(url),
};

/** Map a known key -> adapter (add more “tricky” sites here). */
export const SOURCE_ADAPTERS: Record<string, SourceAdapter> = {
  fantasylife: fantasylifeAdapter,
};
