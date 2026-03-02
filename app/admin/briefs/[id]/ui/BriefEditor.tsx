// app/admin/briefs/[id]/ui/BriefEditor.tsx
"use client";

import { useState } from "react";

type BriefStatus = "draft" | "published" | "archived";

type FormState = {
  summary: string;
  why_matters: string[];
  seo_title: string | null;
  seo_description: string | null;
  status: BriefStatus;
  slug: string;
};

export default function BriefEditor({
  briefId,
  initial,
}: {
  briefId: number;
  initial: FormState;
}) {
  const [form, setForm] = useState<FormState>(initial);
  const [saving, setSaving] = useState<boolean>(false);
  const [msg, setMsg] = useState<string>("");

  const updateField = (key: keyof FormState, value: string | BriefStatus | string[] | null) => {
    setForm((f) => ({ ...f, [key]: value } as FormState));
  };

  const onSave = async () => {
    setSaving(true);
    setMsg("");
    try {
      const res = await fetch(`/api/briefs/${briefId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = (await res.json()) as unknown;
      if (!res.ok) {
        const errText =
          typeof data === "object" && data !== null && "error" in (data as Record<string, unknown>)
            ? String((data as { error: unknown }).error)
            : `HTTP ${res.status}`;
        setMsg(`Save failed: ${errText}`);
      } else {
        setMsg("Saved ✓");
      }
    } catch (e) {
      setMsg("Save failed: network error");
    } finally {
      setSaving(false);
    }
  };

  const whyMattersText = form.why_matters.join("\n");

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        onSave().catch(() => {});
      }}
    >
      <div>
        <label className="mb-1 block text-sm font-medium">Status</label>
        <select
          className="w-full rounded-md border p-2"
          value={form.status}
          onChange={(e) => updateField("status", e.target.value as BriefStatus)}
        >
          <option value="draft">draft</option>
          <option value="published">published</option>
          <option value="archived">archived</option>
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">Slug</label>
        <input
          className="w-full rounded-md border p-2"
          value={form.slug}
          onChange={(e) => updateField("slug", e.target.value)}
        />
        <p className="mt-1 text-xs text-zinc-500">Changing slug updates the brief URL.</p>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">SEO Title (optional)</label>
        <input
          className="w-full rounded-md border p-2"
          value={form.seo_title ?? ""}
          placeholder="Leave blank to use the article title"
          onChange={(e) => updateField("seo_title", e.target.value.length ? e.target.value : null)}
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">SEO Description (optional)</label>
        <textarea
          className="h-24 w-full rounded-md border p-2"
          value={form.seo_description ?? ""}
          onChange={(e) =>
            updateField("seo_description", e.target.value.length ? e.target.value : null)
          }
        />
        <p className="mt-1 text-xs text-zinc-500">Aim for ~150–160 chars.</p>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">Summary</label>
        <textarea
          className="h-28 w-full rounded-md border p-2"
          value={form.summary}
          onChange={(e) => updateField("summary", e.target.value)}
        />
        <p className="mt-1 text-xs text-zinc-500">Keep it original and ≤75 words.</p>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">Why it matters (1–2 lines)</label>
        <textarea
          className="h-20 w-full rounded-md border p-2"
          value={whyMattersText}
          onChange={(e) => updateField("why_matters", e.target.value.split("\n").filter(Boolean))}
        />
        <p className="mt-1 text-xs text-zinc-500">One bullet per line.</p>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md border px-4 py-2 text-sm font-semibold hover:bg-zinc-50 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        <span className="text-sm text-zinc-600">{msg}</span>
      </div>
    </form>
  );
}
