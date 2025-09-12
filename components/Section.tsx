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
        "rounded-none",                // ⟵ no rounded corners anywhere
        "shadow-none sm:shadow-sm",
        className,
      ].join(" ")}
    >
      <header
        className="
          relative
          rounded-none
        "
      >
        {/* subtle red wash */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-red-600/10 to-red-600/0"
        />
        <h2
          className="
            relative
            px-3 sm:px-4
            py-3.5 sm:py-4           // ⟵ slightly taller on mobile
            text-base sm:text-lg
            font-semibold text-zinc-900
          "
        >
          {title}
        </h2>
      </header>

      {/* a hair more left padding to push favicons off the edge */}
      <div className="pl-2 pr-2 py-2 sm:px-2 sm:py-3">{children}</div>
    </section>
  );
}
