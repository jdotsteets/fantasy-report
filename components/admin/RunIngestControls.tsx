"use client";

import { useFormStatus } from "react-dom";
import type { PropsWithChildren } from "react";

export function PendingFieldset({ children }: PropsWithChildren) {
  const { pending } = useFormStatus();
  return (
    <fieldset
      disabled={pending}
      className={pending ? "opacity-60 pointer-events-none" : undefined}
    >
      {children}
    </fieldset>
  );
}

export function RunIngestButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-8 rounded-lg border px-3 text-sm font-medium hover:bg-gray-50 disabled:opacity-60"
      title={pending ? "Ingest running…" : "Run ingest now"}
    >
      {pending ? "Running…" : "Run Ingest"}
    </button>
  );
}
