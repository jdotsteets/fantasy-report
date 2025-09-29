"use client";

import { useState } from "react";

type BriefStatus = "draft" | "published" | "archived";

export default function CreateBriefButton() {
  const [open, setOpen] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [msg, setMsg] = useState<string>("");

  const [articleId, setArticleId] = useState<string>("");
  const [summary, setSummary] = useState<string>("");
  const [whyMatters, setWhyMatters] = useState<string>(""); // one bullet per line
  const [seoTitle, setSeoTitle] = useState<string>("");
  const [seoDescription, setSeoDescription] = useState<string>("");
  const [status, setStatus] = useState<BriefStatus>("published");

  async function onSubmit() {
    setSaving(true);
    setMsg("");
    try {
      const idNum = Number(articleId.trim());
      if (!Number.isFinite(idNum) || idNum <= 0) {
        setMsg("Please enter a valid numeric article_id.");
        setSaving(false);
        return;
      }
      const whyArr = whyMatters
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      const res = await fetch("/api/briefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          article_id: idNum,
          summary,
          why_matters: whyArr,
          seo_title: seoTitle.length ? seoTitle : null,
          seo_description: seoDescription.length ? seoDescription : null,
          status, // server casts to brief_status
        }),
      });

      const data = (await res.json()) as {
        id?: number | string;
        slug?: string;
        error?: unknown;
      };

      if (!res.ok) {
        setMsg(`Failed: ${String((data && (data as { error?: unknown }).error) ?? res.status)}`);
        setSaving(false);
        return;
      }

      setMsg("Created ✓");
      // Quick redirect to the new brief page
      if (data.slug) {
        window.location.href = `/admin/briefs/${String(data.id ?? "")}`; // to edit
      } else {
        setSaving(false);
      }
    } catch {
      setMsg("Network error");
      setSaving(false);
    }
  }

  return (
    <div>
      <button
        className="rounded-md border px-3 py-2 text-sm font-semibold hover:bg-zinc-50"
        onClick={() => setOpen(true)}
      >
        + Create Brief
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-xl rounded-lg border bg-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Create Brief</h2>
              <button
                className="rounded-md border px-2 py-1 text-sm hover:bg-zinc-50"
                onClick={() => setOpen(false)}
                disabled={saving}
              >
                Close
              </button>
            </div>

            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                onSubmit().catch(() => {});
              }}
            >
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium">Article ID</label>
                  <input
                    className="w-full rounded-md border p-2"
                    inputMode="numeric"
                    value={articleId}
                    onChange={(e) => setArticleId(e.target.value)}
                    placeholder="e.g. 327276"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Status</label>
                  <select
                    className="w-full rounded-md border p-2"
                    value={status}
                    onChange={(e) => setStatus(e.target.value as BriefStatus)}
                  >
                    <option value="published">published</option>
                    <option value="draft">draft</option>
                    <option value="archived">archived</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">Summary</label>
                <textarea
                  className="h-24 w-full rounded-md border p-2"
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  placeholder="Two short, original sentences (≤75 words)."
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">Why it matters (1–2 bullets)</label>
                <textarea
                  className="h-20 w-full rounded-md border p-2"
                  value={whyMatters}
                  onChange={(e) => setWhyMatters(e.target.value)}
                  placeholder={"One bullet per line\nExample: Borderline WR2 outlook vs DET man coverage."}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium">SEO Title (optional)</label>
                  <input
                    className="w-full rounded-md border p-2"
                    value={seoTitle}
                    onChange={(e) => setSeoTitle(e.target.value)}
                    placeholder="Leave blank to use article title"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">SEO Description (optional)</label>
                  <input
                    className="w-full rounded-md border p-2"
                    value={seoDescription}
                    onChange={(e) => setSeoDescription(e.target.value)}
                    placeholder="~150–160 chars"
                  />
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-md border px-4 py-2 text-sm font-semibold hover:bg-zinc-50 disabled:opacity-60"
                >
                  {saving ? "Creating…" : "Create"}
                </button>
                <span className="text-sm text-zinc-600">{msg}</span>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
