// lib/fetch-article-text.ts
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { dbQuery } from "@/lib/db";

function extractStructuredText(html: string, baseUrl: string): string {
  const dom = new JSDOM(html, { url: baseUrl });
  const doc = dom.window.document;

  // Make line breaks explicit before Readability flattening
  // Convert <br> to '\n'
  doc.querySelectorAll("br").forEach((br) => br.replaceWith(doc.createTextNode("\n")));

  // Prefix list items with a bullet + space so we can detect list rows
  doc.querySelectorAll("li").forEach((li) => {
    const txt = doc.createTextNode("• ");
    li.insertBefore(txt, li.firstChild);
    // Ensure each li ends with a newline
    li.appendChild(doc.createTextNode("\n"));
  });

  // Ensure block elements are separated by blank lines
  const BLOCKS = "p,div,section,article,header,footer,main,aside,nav,blockquote,pre,figure,figcaption";
  doc.querySelectorAll(BLOCKS).forEach((el) => {
    // add a trailing newline to each block
    el.appendChild(doc.createTextNode("\n\n"));
  });

  // Headings: force their own lines
  doc.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((h) => {
    h.insertBefore(doc.createTextNode("\n"), h.firstChild);
    h.appendChild(doc.createTextNode("\n\n"));
  });

  const reader = new Readability(doc);
  const article = reader.parse();
  const raw = (article?.textContent || "");

  // Normalize spaces *but preserve newlines*
  return raw
    .replace(/\u00A0/g, " ")        // nbsp -> space
    .replace(/[ \t]+\n/g, "\n")     // trim spaces at line end
    .replace(/\n[ \t]+/g, "\n")     // trim spaces at line start
    .replace(/\n{3,}/g, "\n\n")     // collapse huge gaps
    .trim();
}

export async function getArticleText(articleId: number, url: string): Promise<string | null> {
  // 1) cached?
  const cached = await dbQuery<{ content_text: string }>(
    "SELECT content_text FROM article_texts WHERE article_id=$1",
    [articleId]
  );
  if (cached.rows?.[0]?.content_text) return cached.rows[0].content_text;

  // 2) fetch
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) return null;

    const html = await res.text();
    const text = extractStructuredText(html, url);

    // Skip obviously empty parses
    if (!text || text.length < 200) return null;

    await dbQuery(
      `INSERT INTO article_texts (article_id, content_text)
       VALUES ($1,$2)
       ON CONFLICT (article_id) DO UPDATE
       SET content_text = EXCLUDED.content_text`,
      [articleId, text]
    );
    return text;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
