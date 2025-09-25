// lib/site-extractors/index.ts
import { extractCBSWaivers } from "./cbs";
import { extractFantasyPros } from "./fantasypros";
// ...other imports

export function getExtractor(u: URL) {
  const host = u.hostname.toLowerCase();

  if (host.includes("cbssports.com")) return extractCBSWaivers;
  if (host.includes("fantasypros.com")) return extractFantasyPros;

  // default generic extractor (if you have one)
  return (_html: string) => [];
}
