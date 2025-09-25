// components/admin/RunIngestControls.tsx
"use client";

import {
  useCallback,
  useMemo,
  useState,
  type PropsWithChildren,
  FormEvent,
  startTransition,
  useTransition,
} from "react";
import { useFormStatus } from "react-dom";

type ServerAction = (formData: FormData) => Promise<void>;

function PendingFieldsetInner({
  children,
}: PropsWithChildren<{}>) {
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

function RunIngestButtonInner() {
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

/** Client-managed pending wrapper (used when no server action is provided) */
function PendingFieldsetClient({
  pending,
  children,
}: PropsWithChildren<{ pending: boolean }>) {
  return (
    <fieldset
      disabled={pending}
      className={pending ? "opacity-60 pointer-events-none" : undefined}
    >
      {children}
    </fieldset>
  );
}

function RunIngestButtonClient({ pending }: { pending: boolean }) {
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
  action,            // optional Server Action
  className,
  endpoint = "/api/admin/ingest", // API fallback if no action provided
  onDone,            // optional callback with API result
}: {
  action?: ServerAction;
  className?: string;
  endpoint?: string;
  onDone?: (result: unknown) => void;
}) {
  const [isPendingClient, startClientTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const usingServerAction = useMemo(() => typeof action === "function", [action]);

  const handleSubmitClient = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setError(null);

      const fd = new FormData(e.currentTarget);
      const sourceIdRaw = (fd.get("sourceId") as string) || "";
      const limitRaw = (fd.get("limit") as string) || "50";
      const includeHealth = !!fd.get("includeHealth");

      const payload: Record<string, unknown> = {
        limit: Number(limitRaw) || 50,
        includeHealth,
      };
      const sourceId = Number(sourceIdRaw);
      if (sourceId > 0) payload.sourceId = sourceId;

      startClientTransition(async () => {
        try {
          const res = await fetch(endpoint, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) {
            throw new Error(json?.error || `Request failed with ${res.status}`);
          }
          onDone?.(json);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    },
    [endpoint, onDone]
  );

  if (usingServerAction) {
    // Server Action mode (useFormStatus works)
    return (
      <form action={action} className={className}>
        <PendingFieldsetInner>
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

            <RunIngestButtonInner />
          </div>
        </PendingFieldsetInner>
      </form>
    );
  }

  // Client-only mode (POST to API route, manage pending with useTransition)
  return (
    <form onSubmit={handleSubmitClient} className={className}>
      <PendingFieldsetClient pending={isPendingClient}>
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

          <RunIngestButtonClient pending={isPendingClient} />
        </div>

        {error && (
          <div className="mt-2 text-sm text-red-600">
            {error}
          </div>
        )}
      </PendingFieldsetClient>
    </form>
  );
}
