// app/components/Section.tsx
export default function Section({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={[
        "rounded-2xl border border-zinc-200 bg-white shadow-sm",
        className,
      ].join(" ")}
    >
      <header className="relative rounded-t-2xl border-b border-zinc-200">
        {/* very light emerald-800 wash behind the header */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-t-2xl bg-gradient-to-b from-emerald-800/10 to-emerald-800/0"
        />
        <h2 className="relative px-4 py-3 text-lg font-semibold text-zinc-900">
          {title}
        </h2>
      </header>

      <div className="p-2">{children}</div>
    </section>
  );
}
