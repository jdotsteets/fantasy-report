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
        "border border-zinc-200/80 bg-white",
        "rounded-2xl",
        "overflow-hidden",
        "shadow-[0_10px_28px_rgba(0,0,0,0.06)]",
        className,
      ].join(" ")}
    >
      <header className="bg-gradient-to-r from-zinc-950 to-zinc-900 text-white">
        <div className="px-3 sm:px-4 py-3">
          <h2 className="text-[13px] sm:text-[14px] font-semibold uppercase tracking-[0.18em]">
            {title}
          </h2>
        </div>
      </header>

      <div className="p-3 sm:p-4">
        {children}
      </div>
    </section>
  );
}
