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
        // Square edges on mobile; card-like ≥sm
        "border border-zinc-200 bg-white",
        "rounded-none sm:rounded-2xl",
        "shadow-none sm:shadow-sm",
        // 🔴 accent bar
        "border-t-2 border-t-red-600",
        className,
      ].join(" ")}
    >
      <header className="relative border-b border-zinc-200 rounded-t-none sm:rounded-t-2xl">
        {/* 🔴 stronger red header wash so it's clearly visible */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-red-600/15 to-red-600/0 rounded-t-none sm:rounded-t-2xl"
        />
        <h2 className="relative px-2 sm:px-3 py-2 sm:py-2.5 text-base sm:text-lg font-semibold text-zinc-900 tracking-tight">
          {title}
        </h2>
      </header>

      {/* Tight content padding: none on mobile; light padding ≥sm */}
      <div className="p-0 sm:p-2">{children}</div>
    </section>
  );
}
