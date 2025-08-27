// app/players/page.tsx
import { getPlayerMatrix } from "@/lib/playerPages";
import PlayerMatrix from "@/components/players/PlayerMatrix";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function PlayersPage() {
  const { players, domains } = await getPlayerMatrix(180);
  return (
    <main className="mx-auto max-w-6xl p-6 space-y-4">
      <h1 className="text-2xl font-bold">Player Pages</h1>
      <PlayerMatrix players={players} domains={domains} />
    </main>
  );
}