// lib/wiki.ts
export type WikiImage = { src: string; credit: string };

/** Find a plausible player page and return a thumbnail */
export async function findWikipediaHeadshot(name: string): Promise<WikiImage | null> {
  // Bias the query toward football players to avoid namesakes
  const q = `${name} American football`;

  // 1) Search
  const sRes = await fetch(
    `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=1&srsearch=${encodeURIComponent(q)}&origin=*`,
    { next: { revalidate: 60 } }
  );
  const s = await sRes.json();
  const page = s?.query?.search?.[0];
  if (!page?.pageid) return null;

  // 2) Get page image
  const pRes = await fetch(
    `https://en.wikipedia.org/w/api.php?action=query&pageids=${page.pageid}&prop=pageimages|info&piprop=thumbnail|name&pithumbsize=800&inprop=url&format=json&origin=*`,
    { next: { revalidate: 60 } }
  );
  const pj = await pRes.json();
  const p = pj?.query?.pages?.[page.pageid];
  const src: string | undefined = p?.thumbnail?.source;
  if (!src) return null;

  return { src, credit: `Image via Wikipedia – ${p.title}` };
}
