import { useState } from "react";
import type { SearchResult } from "@/types/sources";

type SearchBoxProps = {
  onResults: (items: SearchResult[]) => void;
};

export default function SearchBox({ onResults }: SearchBoxProps) {
  const [value, setValue] = useState("");

  async function handleChange(v: string) {
    setValue(v);
    if (!v.trim()) {
      onResults([]);
      return;
    }
    const res = await fetch(`/api/search?q=${encodeURIComponent(v)}&limit=40`, {
      cache: "no-store",
    });
    const json = await res.json();
    onResults((json.items as SearchResult[]) || []);
  }

  return (
    <input
      value={value}
      onChange={(e) => handleChange(e.target.value)}
      placeholder="Search players..."
      className="w-full rounded-lg border px-3 py-2"
    />
  );
}
