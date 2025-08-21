// app/components/Section.tsx
export default function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <h2 className="px-4 py-3 border-b border-zinc-200 text-lg font-semibold text-zinc-900">
        {title}
      </h2>
      <div className="p-2">{children}</div>
    </section>
  );
}
