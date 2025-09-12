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
        "rounded-t-lg sm:rounded-t-2xl", // ⟵ rounded TOP corners
        "shadow-none sm:shadow-sm",
        className,
      ].join(" ")}
    >
      {/* HEADER */}
      <header
        className="
          relative
          rounded-none
          bg-black   /* ⟵ header background color (change here) */
          text-white /* ⟵ header text color (change here) */
          border-b border-zinc-200
        "
      >
        {/* 👉 HEADER HEIGHT:
            Adjust the vertical padding on the <h2> below.
            - py-2.5   = tighter
            - py-3     = default
            - py-3.5   = a bit taller
            You can set different values for mobile vs. ≥sm if you want. */}
        <h2
          className="
            relative
            px-3 sm:px-4
            py-2 sm:py-3.5  /* ⟵ TWEAK ME: header height (top/bottom padding) */
            text-base sm:text-lg
            font-semibold
          "
        >
          {title}
        </h2>
      </header>

      {/* Body padding; small left/right space to keep favicons/text off the edges */}
      <div className="pl-2 pr-2 py-2 sm:px-2 sm:py-3">
        {children}
      </div>
    </section>
  );
}
