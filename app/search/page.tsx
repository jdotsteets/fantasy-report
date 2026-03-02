// app/search/page.tsx
import { Suspense } from "react";
import SearchClient from "./search-client";

export const dynamic = "force-dynamic"; // avoid prerender issues with URL params
export const revalidate = 0;

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="p-4 text-sm text-zinc-500">Loading search…</div>}>
      <SearchClient />
    </Suspense>
  );
}
