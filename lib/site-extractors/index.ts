// lib/site-extractors/index.ts
import type { Extractor } from "./types";
import { extractCBSWaivers } from "./cbs";
import { extractFantasyPros } from "./fantasypros"; // 👈 use your file
import { extractYahoo } from "./yahoo";


export function getExtractor(u: URL): Extractor {
  const host = u.hostname.toLowerCase();

  if (host.endsWith("cbssports.com")) return extractCBSWaivers;
  if (host.endsWith("fantasypros.com")) return extractFantasyPros; // 👈 map FP

  // fallback: no-op extractor
  return (_html) => [];
}




export { extractFantasyPros } from "./fantasypros";
export { extractYahoo } from "./yahoo";
export type { Extractor, WaiverHit, Pos } from "./types";

/** Map of hostname suffix → extractor */
const SITE_EXTRACTORS: ReadonlyArray<[suffix: string, extractor: Extractor]> = [
  ["fantasypros.com", extractFantasyPros],
  ["sports.yahoo.com", extractYahoo],
];

export function resolveExtractor(url: URL): Extractor | null {
  const host = url.hostname.toLowerCase();
  for (const [suffix, extractor] of SITE_EXTRACTORS) {
    if (host === suffix || host.endsWith(`.${suffix}`)) return extractor;
  }
  return null;
}

export function extractWaivers(html: string, url: URL) {
  const ex = resolveExtractor(url);
  return ex ? ex(html, url) : [];
}
