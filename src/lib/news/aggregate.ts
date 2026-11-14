import "server-only";
import { politeFetch } from "../crawler/polite-fetch";
import { tagStocks } from "../stock-names";
import { scoreHeadline } from "../yahoo";
import { parseFeed } from "./parse";
import { NEWS_SOURCES } from "./sources";

export type NewsArticle = {
  id: string;
  title: string;
  link: string;
  summary: string;
  source: string;
  publishedAt: string | null;
  symbols: string[];
  sentiment: "positive" | "negative" | "neutral";
};

export type SourceStatus = { id: string; name: string; ok: boolean; items: number; error?: string; fetchedAt: string };

export type NewsSnapshot = { articles: NewsArticle[]; sources: SourceStatus[]; fetchedAt: string };

const FRESH_MS = 10 * 60 * 1000;
const MAX_AGE_DAYS = 7;
const MAX_ARTICLES = 600;

const normTitle = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

async function crawl(): Promise<NewsSnapshot> {
  const results = await Promise.all(
    NEWS_SOURCES.map(async (src) => {
      const fetchedAt = new Date().toISOString();
      try {
        const items = parseFeed(await politeFetch(src.url));
        return { src, items, status: { id: src.id, name: src.name, ok: true, items: items.length, fetchedAt } };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { src, items: [], status: { id: src.id, name: src.name, ok: false, items: 0, error: message, fetchedAt } };
      }
    }),
  );

  const cutoff = Date.now() - MAX_AGE_DAYS * 86400_000;
  const seen = new Set<string>();
  const articles: NewsArticle[] = [];
  for (const { src, items } of results) {
    for (const item of items) {
      if (!item.title || !/^https?:\/\//.test(item.link)) continue;
      if (item.publishedAt && Date.parse(item.publishedAt) < cutoff) continue;
      const key = normTitle(item.title);
      if (seen.has(key) || seen.has(item.link)) continue;
      seen.add(key);
      seen.add(item.link);
      articles.push({
        id: hash(item.link),
        title: item.title,
        link: item.link,
        summary: item.summary,
        source: src.name,
        publishedAt: item.publishedAt,
        symbols: tagStocks(`${item.title} ${item.summary}`),
        sentiment: scoreHeadline(item.title).sentiment,
      });
    }
  }
  articles.sort((a, b) => (Date.parse(b.publishedAt ?? "") || 0) - (Date.parse(a.publishedAt ?? "") || 0));

  return { articles: articles.slice(0, MAX_ARTICLES), sources: results.map((r) => r.status), fetchedAt: new Date().toISOString() };
}

let snapshot: { at: number; data: NewsSnapshot } | null = null;
let inflight: Promise<NewsSnapshot> | null = null;

function refresh() {
  inflight ??= crawl()
    .then((data) => {
      snapshot = { at: Date.now(), data };
      return data;
    })
    .finally(() => (inflight = null));
  return inflight;
}

/** Cached for 10 min. When stale, serves the old snapshot and refreshes in the background. */
export async function getNews(): Promise<NewsSnapshot> {
  if (snapshot && Date.now() - snapshot.at < FRESH_MS) return snapshot.data;
  if (snapshot) {
    void refresh().catch(() => undefined);
    return snapshot.data;
  }
  return refresh();
}
