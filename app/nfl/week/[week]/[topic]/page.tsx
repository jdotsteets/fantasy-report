// app/nfl/week/[week]/[topic]/page.tsx
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <main className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-bold">Topic/Week page booted ✅</h1>
    </main>
  );
}
