// components/AdapterConfigFields.tsx
"use client";

import { useState, useEffect } from "react";

export type AdapterConfig = {
  limit?: number;
  daysBack?: number;
  pageCount?: number;
  // Add site-specific fields here if you need later:
  // headers?: Record<string, string>;
};

type Props = {
  initial?: AdapterConfig | null;
  onChange: (cfg: AdapterConfig) => void;
};

export default function AdapterConfigFields({ initial, onChange }: Props) {
  const [limit, setLimit] = useState<number | undefined>(initial?.limit);
  const [daysBack, setDaysBack] = useState<number | undefined>(initial?.daysBack);
  const [pageCount, setPageCount] = useState<number | undefined>(initial?.pageCount ?? 2);

  useEffect(() => {
    onChange({
      limit: typeof limit === "number" && Number.isFinite(limit) ? limit : undefined,
      daysBack: typeof daysBack === "number" && Number.isFinite(daysBack) ? daysBack : undefined,
      pageCount: typeof pageCount === "number" && Number.isFinite(pageCount) ? pageCount : undefined,
    });
  }, [limit, daysBack, pageCount, onChange]);

  return (
    <div className="grid gap-2">
      <label className="flex items-center gap-2">
        <span className="w-28">Limit</span>
        <input
          type="number"
          inputMode="numeric"
          className="input"
          placeholder="e.g. 200"
          value={limit ?? ""}
          onChange={(e) => setLimit(e.target.value === "" ? undefined : Number(e.target.value))}
          min={0}
        />
      </label>

      <label className="flex items-center gap-2">
        <span className="w-28">Days back</span>
        <input
          type="number"
          inputMode="numeric"
          className="input"
          placeholder="e.g. 45"
          value={daysBack ?? ""}
          onChange={(e) => setDaysBack(e.target.value === "" ? undefined : Number(e.target.value))}
          min={0}
        />
      </label>

      <label className="flex items-center gap-2">
        <span className="w-28">Page count</span>
        <input
          type="number"
          inputMode="numeric"
          className="input"
          placeholder="e.g. 2"
          value={pageCount ?? ""}
          onChange={(e) => setPageCount(e.target.value === "" ? undefined : Number(e.target.value))}
          min={1}
        />
      </label>
    </div>
  );
}
