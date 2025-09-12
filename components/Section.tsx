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
        "border border-zinc-200 bg-white",
        "rounded-none sm:rounded-2xl",
        "shadow-none sm:shadow-sm",
        className,
      ].join(" ")}
    >
      <header className="relative border-b border-zinc-200 rounded-t-none sm:rounded-t-2xl">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-red-700/10 to-red-700/0 rounded-t-none sm:rounded-t-2xl"
        />
        <h2 className="relative px-3 sm:px-4 py-2.5 sm:py-3 text-base sm:text-lg font-semibold text-zinc-900">
          {title}
        </h2>
      </header>

      <div className="px-3 py-2 sm:p-3">{children}</div>
    </section>
  );
}
