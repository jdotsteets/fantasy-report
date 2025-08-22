// Best-effort extraction of article image
export async function findArticleImage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" }, redirect: "follow" });
    if (!res.ok) return null;
    const html = await res.text();

    const pick = (re: RegExp) => {
      const m = html.match(re);
      return m?.[1] ? new URL(m[1], url).toString() : null;
    };

    // og:image / twitter:image
    return (
      pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
      pick(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i) ||
      null
    );
  } catch {
    return null;
  }
}
