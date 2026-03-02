"use server";

import { revalidatePath } from "next/cache";

export async function quickAddSource(formData: FormData) {
  const payload = {
    name: (formData.get("name") as string | null)?.trim() || null,
    rss_url: (formData.get("rss_url") as string | null)?.trim() || null,
    homepage_url: (formData.get("homepage_url") as string | null)?.trim() || null,
    scrape_selector: (formData.get("scrape_selector") as string | null)?.trim() || null,
    allowed: true,
  };

  await fetch(`${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/api/admin/sources`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  revalidatePath("/admin/sources");
}
