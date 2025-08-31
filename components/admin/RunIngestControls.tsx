// components/admin/RunIngestControls.tsx
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

export default function RunIngestControls({
  action,
  className,
}: {
  action: (formData: FormData) => Promise<void>;
  className?: string;
}) {
  return (
    <form action={action} className={className}>
      <PendingFieldset>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <div className="mb-1 text-zinc-600">sourceId (optional)</div>
            <input
              name="sourceId"
              type="number"
              min={1}
              className="h-8 w-28 rounded border px-2 text-sm"
              placeholder="123"
            />
          </label>

          <label className="text-sm">
            <div className="mb-1 text-zinc-600">limit</div>
            <input
              name="limit"
              type="number"
              min={1}
              max={500}
              defaultValue={50}
              className="h-8 w-24 rounded border px-2 text-sm"
            />
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input name="includeHealth" type="checkbox" defaultChecked />
            <span>include health</span>
          </label>

          <RunIngestButton />
        </div>
      </PendingFieldset>
    </form>
  );
}
