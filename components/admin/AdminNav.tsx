"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type AdminKey = "sources" | "excluded";

export function AdminNav({ active }: { active?: AdminKey }) {
  const pathname = usePathname();
  const items: { href: string; key: AdminKey; label: string }[] = [
    { href: "/admin/sources",  key: "sources",  label: "Sources" },
    { href: "/admin/excluded", key: "excluded", label: "Excluded" },
  ];

  return (
    <nav className="mb-6 flex gap-2">
      {items.map((it) => {
        const isActive =
          active === it.key || pathname?.startsWith(it.href);
        return (
          <Link
            key={it.key}
            href={it.href}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              isActive
                ? "border-emerald-600 bg-emerald-50 text-emerald-800"
                : "border-zinc-300 hover:bg-zinc-50"
            }`}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
