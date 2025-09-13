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
        "rounded-t-lg sm:rounded-t-2xl", // rounded TOP corners
        "overflow-hidden",               // <-- KEY: clip header to the curve
        "shadow-none sm:shadow-sm",
        "overflow-hidden",
        className,
      ].join(" ")}
    >
      <header
        className="
          relative
          bg-black text-white
          border-b border-zinc-200
          rounded-t-lg sm:rounded-t-2xl   /* mirror top radius (optional but nice) */
          overflow-hidden
        "
      >
        {/* HEADER HEIGHT: tweak py values below */}
        <h2 className="relative px-3 sm:px-4 py-2.5 sm:py-3 text-base sm:text-lg font-semibold">
          {title}
        </h2>
      </header>

      {/* Body padding; keeps favicons/text off the edges */}
      <div className="pl-2 pr-2 py-2 sm:px-2 sm:py-3">
        {children}
      </div>
    </section>
  );
}
