"use client";

import { usePathname, useRouter } from "next/navigation";
import { Search as SearchIcon } from "lucide-react";

export default function SearchToggle({ className = "" }: { className?: string }) {
  const pathname = usePathname() || "/";
  const router = useRouter();

  const onClick = () => {
    if (pathname === "/search") {
      router.push("/");          // already on search -> go home
    } else {
      router.push("/search");    // open search
    }
  };

  const active = pathname === "/search";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={active ? "Close search" : "Open search"}
      className={[
        "inline-flex h-8 w-8 items-center justify-center rounded-md border",
        active
          ? "bg-zinc-800 text-white border-zinc-700"
          : "bg-zinc-900 text-white border-zinc-700 hover:bg-zinc-800",
        "focus:outline-none focus:ring-2 focus:ring-red-600/40",
        className,
      ].join(" ")}
    >
      <SearchIcon size={16} />
    </button>
  );
}
