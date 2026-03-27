import type { ReactNode } from "react";

export default function BetaSection({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 sm:text-lg">
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>
          ) : null}
        </div>
        {action ? <div className="text-sm text-zinc-600">{action}</div> : null}
      </header>
      <div className="px-3 py-3 sm:px-4 sm:py-4">{children}</div>
    </section>
  );
}
