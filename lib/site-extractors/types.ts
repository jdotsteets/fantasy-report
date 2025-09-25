// lib/site-extractors/types.ts
export type Pos = "QB" | "RB" | "WR" | "TE" | "K" | "DST";

export type WaiverHit = {
  name: string;          // "Jake Browning" or "Bengals D/ST"
  pos?: Pos;             // normalized to the union above
  section?: string;      // e.g., "Quarterbacks"
  hint?: string;         // "card" | "list" | "table" | etc.
};

export type Extractor = (html: string, url: URL) => WaiverHit[];
