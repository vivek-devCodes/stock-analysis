"use client";

import Link from "next/link";
import { AlertTriangle, Ban, Clock, ExternalLink, Flame, Inbox, Loader2, Newspaper, RefreshCw, Rss, Search, Tag } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { clsx } from "@/lib/format";
import { PageHeader } from "./shell/PageHeader";

type Article = {
  id: string;
  title: string;
  link: string;
  summary: string;
  source: string;
  publishedAt: string | null;
  symbols: string[];
  sentiment: "positive" | "negative" | "neutral";
};
type SourceStatus = { id: string; name: string; ok: boolean; items: number; error?: string; fetchedAt: string };
type NewsResponse = {
  articles: Article[];
  sources: SourceStatus[];
  excluded: Array<{ name: string; reason: string }>;
  fetchedAt: string;
};

const REFRESH_MS = 5 * 60 * 1000;
const PAGE = 60;
const short = (s: string) => s.replace(/\.NS$/, "");

function ago(iso: string | null) {
  if (!iso) return "";
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

export function NewsModule() {
  const [data, setData] = useState<NewsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("All");
  const [stock, setStock] = useState("All");
  const [sentiment, setSentiment] = useState<"all" | Article["sentiment"]>("all");
  const [taggedOnly, setTaggedOnly] = useState(false);
  const [shown, setShown] = useState(PAGE);

  const fetchNews = useCallback(async () => {
    const res = await fetch("/api/news");
    if (res.status === 401) {
      window.location.replace("/login");
      return null;
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Could not load news");
    return json as NewsResponse;
  }, []);

  const apply = useCallback(
    (p: Promise<NewsResponse | null>) =>
      p
        .then((d) => {
          if (d) {
            setData(d);
            setError(null);
          }
        })
        .catch((e) => setError(e instanceof Error ? e.message : "Could not load news"))
        .finally(() => setLoading(false)),
    [],
  );

  useEffect(() => {
    void apply(fetchNews());
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void apply(fetchNews());
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [apply, fetchNews]);

  const sources = useMemo(() => ["All", ...new Set((data?.articles ?? []).map((a) => a.source))], [data]);

  const trending = useMemo(() => {
    const dayAgo = (data ? Date.parse(data.fetchedAt) : 0) - 86400_000;
    const counts = new Map<string, { n: number; net: number }>();
    for (const a of data?.articles ?? []) {
      if (a.publishedAt && Date.parse(a.publishedAt) < dayAgo) continue;
      for (const s of a.symbols) {
        const c = counts.get(s) ?? { n: 0, net: 0 };
        c.n += 1;
        c.net += a.sentiment === "positive" ? 1 : a.sentiment === "negative" ? -1 : 0;
        counts.set(s, c);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 12);
  }, [data]);

  const stocks = useMemo(() => {
    const all = new Set<string>();
    for (const a of data?.articles ?? []) a.symbols.forEach((s) => all.add(s));
    return ["All", ...[...all].sort()];
  }, [data]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.articles ?? []).filter(
      (a) =>
        (source === "All" || a.source === source) &&
        (stock === "All" || a.symbols.includes(stock)) &&
        (sentiment === "all" || a.sentiment === sentiment) &&
        (!taggedOnly || a.symbols.length > 0) &&
        (!q || a.title.toLowerCase().includes(q) || a.summary.toLowerCase().includes(q)),
    );
  }, [data, query, source, stock, sentiment, taggedOnly]);

  const pickStock = (s: string) => {
    setStock(s);
    setShown(PAGE);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div>
      <div className="px-4 pt-4 sm:px-6 sm:pt-6">
        <PageHeader
          icon={Newspaper}
          tone="text-[#f472b6]"
          title="Market News"
          subtitle="Headlines from Indian financial media, tagged by stock — refreshed every 5 minutes"
          actions={
        <button
          onClick={() => {
            setLoading(true);
            void apply(fetchNews());
          }}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl border border-line bg-card px-3 py-2 text-sm hover:bg-white/5 disabled:opacity-50"
        >
          <RefreshCw className={clsx("h-4 w-4", loading && "animate-spin")} />
          Refresh
        </button>
          }
        />
      </div>

      <div className="grid gap-4 p-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <main className="space-y-3">
          <div className="panel flex flex-wrap items-center gap-2 p-3">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" />
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setShown(PAGE);
                }}
                placeholder="Search headlines…"
                className="w-full rounded-xl border border-line bg-card px-9 py-2 text-sm outline-none ring-accent/40 focus:ring-2"
              />
            </div>
            <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source" className="rounded-xl border border-line bg-card px-3 py-2 text-sm">
              {sources.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <select value={stock} onChange={(e) => setStock(e.target.value)} aria-label="Stock" className="rounded-xl border border-line bg-card px-3 py-2 text-sm">
              {stocks.map((s) => (
                <option key={s} value={s}>
                  {s === "All" ? "All stocks" : short(s)}
                </option>
              ))}
            </select>
            <select value={sentiment} onChange={(e) => setSentiment(e.target.value as typeof sentiment)} aria-label="Sentiment" className="rounded-xl border border-line bg-card px-3 py-2 text-sm">
              <option value="all">Any sentiment</option>
              <option value="positive">Positive</option>
              <option value="negative">Negative</option>
              <option value="neutral">Neutral</option>
            </select>
            <label className="flex items-center gap-2 text-xs text-muted">
              <input type="checkbox" checked={taggedOnly} onChange={(e) => setTaggedOnly(e.target.checked)} />
              Stock-specific only
            </label>
          </div>

          {error && (
            <p className="panel flex items-center gap-2 border-down/40 p-3 text-sm text-down">
              <AlertTriangle className="h-4 w-4" /> {error}
            </p>
          )}
          {data && filtered.length === 0 && (
            <p className="panel flex items-center gap-2 p-6 text-sm text-muted">
              <Inbox className="h-5 w-5" /> No headlines match these filters.
            </p>
          )}
          {!data && loading && (
            <div className="panel flex items-center gap-3 p-6 text-sm text-muted">
              <Loader2 className="h-5 w-5 animate-spin" /> Crawling news sources… the first load takes up to 20 seconds.
            </div>
          )}

          {data && (
            <p className="text-xs text-muted">
              {filtered.length} of {data.articles.length} headlines · crawled {ago(data.fetchedAt)} · auto-refresh every 5 min
            </p>
          )}

          {filtered.slice(0, shown).map((a) => (
            <article key={a.id} className="panel p-4">
              <div className="flex items-center gap-2 text-[11px] text-muted">
                <span
                  className={clsx(
                    "h-2 w-2 rounded-full",
                    a.sentiment === "positive" ? "bg-up" : a.sentiment === "negative" ? "bg-down" : "bg-muted",
                  )}
                  title={`Keyword sentiment: ${a.sentiment}`}
                />
                <Rss className="h-3 w-3" />
                <span className="font-semibold text-foreground/80">{a.source}</span>
                <Clock className="ml-1 h-3 w-3" />
                <span>{ago(a.publishedAt)}</span>
              </div>
              <a
                href={a.link}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-start gap-1 text-sm font-semibold leading-snug hover:text-accent"
              >
                {a.title}
                <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-muted" />
              </a>
              {a.summary && a.summary !== a.title && <p className="mt-1 line-clamp-2 text-xs text-muted">{a.summary}</p>}
              {a.symbols.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Tag className="h-3 w-3 text-muted" />
                  {a.symbols.map((s) => (
                    <span key={s} className="inline-flex overflow-hidden rounded-md border border-line text-[11px]">
                      <button onClick={() => pickStock(s)} className="px-2 py-0.5 hover:bg-white/5" title="Show news for this stock">
                        {short(s)}
                      </button>
                      <Link href={`/analyze?symbol=${encodeURIComponent(s)}`} className="border-l border-line px-1.5 py-0.5 text-accent hover:bg-white/5" title="Open chart">
                        chart
                      </Link>
                    </span>
                  ))}
                </div>
              )}
            </article>
          ))}

          {filtered.length > shown && (
            <button onClick={() => setShown((n) => n + PAGE)} className="w-full rounded-xl border border-line py-2 text-sm text-accent hover:bg-white/5">
              Load more ({filtered.length - shown} left)
            </button>
          )}
        </main>

        <aside className="space-y-4">
          <section className="panel p-4">
            <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
              <Flame className="h-4 w-4 text-warn" /> Trending stocks (24h)
            </h2>
            {trending.length === 0 && <p className="mt-2 text-xs text-muted">No stock mentions yet.</p>}
            <ul className="mt-2 space-y-1">
              {trending.map(([s, c]) => (
                <li key={s}>
                  <button onClick={() => pickStock(s)} className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-sm hover:bg-white/5">
                    <span>{short(s)}</span>
                    <span className="text-xs">
                      <span className="text-muted">{c.n} stories </span>
                      <span className={c.net > 0 ? "text-up" : c.net < 0 ? "text-down" : "text-muted"}>
                        {c.net > 0 ? "▲" : c.net < 0 ? "▼" : "•"}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {data && (
            <section className="panel p-4 text-xs">
              <h2 className="flex items-center gap-2 font-semibold uppercase tracking-wider text-muted">
                <Rss className="h-4 w-4 text-accent" /> Sources
              </h2>
              <ul className="mt-2 space-y-1">
                {data.sources.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2" title={s.error}>
                    <span>{s.name} <span className="text-muted">({s.id.split("-").slice(1).join(" ") || "feed"})</span></span>
                    <span className={s.ok ? "text-up" : "text-down"}>{s.ok ? s.items : "error"}</span>
                  </li>
                ))}
              </ul>
              <h3 className="mt-4 flex items-center gap-2 font-semibold uppercase tracking-wider text-muted">
                <Ban className="h-4 w-4 text-down" /> Not included
              </h3>
              <ul className="mt-2 space-y-1.5 text-muted">
                {data.excluded.map((e) => (
                  <li key={e.name}>
                    <span className="text-foreground/80">{e.name}</span> — {e.reason}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[11px] text-muted">
                The crawler obeys robots.txt, waits between requests to each site and identifies itself honestly. Sentiment is a simple keyword score.
              </p>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
