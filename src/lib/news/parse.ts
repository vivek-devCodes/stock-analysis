// Feed parsing from scratch: RSS 2.0, Atom and Google News sitemaps. No XML library —
// these formats are shallow, so targeted regexes over <item>/<entry>/<url> blocks are enough.

export type RawItem = { title: string; link: string; publishedAt: string | null; summary: string };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

/** Text inside <tag>…</tag> (namespaced tags allowed), with CDATA unwrapped, HTML stripped, entities decoded. */
function tagText(block: string, tag: string): string {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i");
  const m = block.match(re);
  if (!m) return "";
  let inner = m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  inner = decodeEntities(inner); // feeds often double-encode HTML
  return decodeEntities(inner.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function atomLink(block: string): string {
  const links = [...block.matchAll(/<link\b([^>]*)\/?>/gi)].map((m) => m[1]);
  const alt = links.find((a) => !/rel=["'](?!alternate)/i.test(a)) ?? links[0];
  return decodeEntities(alt?.match(/href=["']([^"']+)["']/i)?.[1] ?? "");
}

function isoDate(value: string): string | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function blocks(xml: string, tag: string): string[] {
  return xml.match(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`, "gi")) ?? [];
}

export function parseFeed(xml: string): RawItem[] {
  // RSS 2.0
  const rss = blocks(xml, "item");
  if (rss.length) {
    return rss.map((b) => ({
      title: tagText(b, "title"),
      link: tagText(b, "link") || tagText(b, "guid"),
      publishedAt: isoDate(tagText(b, "pubDate") || tagText(b, "dc:date") || tagText(b, "published")),
      summary: tagText(b, "description").slice(0, 400),
    }));
  }
  // Atom
  const atom = blocks(xml, "entry");
  if (atom.length) {
    return atom.map((b) => ({
      title: tagText(b, "title"),
      link: atomLink(b),
      publishedAt: isoDate(tagText(b, "published") || tagText(b, "updated")),
      summary: (tagText(b, "summary") || tagText(b, "content")).slice(0, 400),
    }));
  }
  // Google News sitemap (<url><loc/><news:news><news:title/><news:publication_date/></news:news></url>)
  return blocks(xml, "url")
    .filter((b) => /<news:news\b/i.test(b))
    .map((b) => ({
      title: tagText(b, "news:title"),
      link: tagText(b, "loc"),
      publishedAt: isoDate(tagText(b, "news:publication_date")),
      summary: tagText(b, "news:keywords").slice(0, 200),
    }));
}
