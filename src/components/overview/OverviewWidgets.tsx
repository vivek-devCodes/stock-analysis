"use client";

import Link from "next/link";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Bitcoin,
  Building2,
  Globe,
  Inbox,
  Landmark,
  Loader2,
  Newspaper,
  Star,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { clsx, formatPercent } from "@/lib/format";
import type { LiveQuote } from "@/lib/types";
import { loadWatchlist } from "@/lib/watchlist";
import { LiveBadge } from "../LiveBadge";
import { Card } from "../shell/PageHeader";
import { INDEX_LABELS, useMarket } from "../shell/market-store";

const short = (s: string) => s.replace(/\.NS$/, "");
const price = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

/* ------------------------------- KPI row ------------------------------- */

const KPI: Array<{ symbol: string; icon: LucideIcon }> = [
  { symbol: "^NSEI", icon: Landmark },
  { symbol: "^BSESN", icon: Building2 },
  { symbol: "^NSEBANK", icon: Landmark },
  { symbol: "^GSPC", icon: Globe },
  { symbol: "BTC-USD", icon: Bitcoin },
];

export function MarketKpis() {
  const { quotes, asOf } = useMarket();
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {KPI.map(({ symbol, icon: Icon }) => {
          const q = quotes.find((x) => x.symbol === symbol);
          const up = (q?.changePercent ?? 0) >= 0;
          return (
            <Link key={symbol} href={`/analyze?symbol=${encodeURIComponent(symbol)}`} className="panel group p-4 transition-colors hover:border-white/20">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-xs text-muted">
                  <Icon className="h-4 w-4" />
                  {INDEX_LABELS[symbol]}
                </span>
                {q && <LiveBadge quote={q} compact />}
              </div>
              {q ? (
                <>
                  <p className="mt-2 font-mono text-xl font-semibold">{price(q.price)}</p>
                  <p className={clsx("mt-0.5 flex items-center gap-1 text-xs", up ? "text-up" : "text-down")}>
                    {up ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                    {q.change >= 0 ? "+" : ""}
                    {price(q.change)} ({formatPercent(q.changePercent)})
                  </p>
                </>
              ) : (
                <div className="mt-3 h-10 animate-pulse rounded-md bg-white/5" />
              )}
            </Link>
          );
        })}
      </div>
      {asOf && (
        <p className="text-[11px] text-muted">
          Live prices refresh every 10 s · last update {new Date(asOf).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })} IST · NSE/BSE on Yahoo
          are 15 min delayed when NSE&apos;s live feed is unavailable
        </p>
      )}
    </div>
  );
}

/* ------------------------------ Watchlist ------------------------------ */

export function WatchlistWidget() {
  const [rows, setRows] = useState<LiveQuote[] | null>(null);
  useEffect(() => {
    const symbols = loadWatchlist().slice(0, 8);
    fetch(`/api/live?symbols=${encodeURIComponent(symbols.join(","))}`)
      .then((r) => (r.ok ? r.json() : { quotes: [] }))
      .then((j) => setRows(j.quotes ?? []))
      .catch(() => setRows([]));
  }, []);

  return (
    <Card
      icon={Star}
      tone="text-warn"
      title="My watchlist"
      action={
        <Link href="/analyze" className="flex items-center gap-1 text-xs text-accent hover:underline">
          Manage <ArrowRight className="h-3 w-3" />
        </Link>
      }
    >
      {rows == null ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty text="Add stocks from the Stock Analyzer." />
      ) : (
        <ul className="divide-y divide-line/60">
          {rows.map((q) => (
            <li key={q.symbol}>
              <Link href={`/analyze?symbol=${encodeURIComponent(q.symbol)}`} className="flex items-center justify-between gap-2 py-2 text-sm hover:text-accent">
                <span className="flex items-center gap-2">
                  <LiveBadge quote={q} compact />
                  <span className="font-medium">{short(q.symbol)}</span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-mono">{price(q.price)}</span>
                  <span className={clsx("w-16 text-right text-xs", q.changePercent >= 0 ? "text-up" : "text-down")}>
                    {formatPercent(q.changePercent)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ---------------------------- Top-ranked stocks ---------------------------- */

type Fund = { symbol: string; name: string; sector: string; scores: { overall: number; quality: number; growth: number; value: number } };

export function TopStocksWidget() {
  const [rows, setRows] = useState<Fund[] | null>(null);
  useEffect(() => {
    fetch("/api/fundamentals")
      .then((r) => (r.ok ? r.json() : { stocks: [] }))
      .then((j) => setRows((j.stocks ?? []).slice(0, 6)))
      .catch(() => setRows([]));
  }, []);

  return (
    <Card
      icon={Trophy}
      tone="text-[#4fd1c5]"
      title="Top-ranked by fundamentals"
      action={
        <Link href="/screener" className="flex items-center gap-1 text-xs text-accent hover:underline">
          Screener <ArrowRight className="h-3 w-3" />
        </Link>
      }
    >
      {rows == null ? (
        <Loading text="Scoring stocks… first load ~20 s" />
      ) : rows.length === 0 ? (
        <Empty text="Fundamentals unavailable right now." />
      ) : (
        <ol className="space-y-2">
          {rows.map((f, i) => (
            <li key={f.symbol}>
              <Link href={`/analyze?symbol=${encodeURIComponent(f.symbol)}`} className="flex items-center gap-3 text-sm hover:text-accent">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/5 text-[11px] text-muted">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{short(f.symbol)}</span>
                  <span className="ml-2 truncate text-xs text-muted">{f.sector}</span>
                </span>
                <span className="hidden text-[10px] text-muted sm:inline">
                  Q{f.scores.quality} G{f.scores.growth} V{f.scores.value}
                </span>
                <span
                  className={clsx(
                    "rounded-md px-2 py-0.5 font-mono text-xs font-semibold",
                    f.scores.overall >= 65 ? "bg-up/15 text-up" : f.scores.overall >= 45 ? "bg-warn/15 text-warn" : "bg-down/15 text-down",
                  )}
                >
                  {f.scores.overall}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

/* ------------------------------ Headlines ------------------------------ */

type Article = { id: string; title: string; link: string; source: string; publishedAt: string | null; symbols: string[]; sentiment: string };

function ago(iso: string | null, now: number) {
  if (!iso) return "";
  const mins = Math.round((now - Date.parse(iso)) / 60000);
  if (mins < 60) return `${Math.max(mins, 1)}m`;
  if (mins < 2880) return `${Math.round(mins / 60)}h`;
  return `${Math.round(mins / 1440)}d`;
}

export function HeadlinesWidget() {
  const [data, setData] = useState<{ articles: Article[]; fetchedAt: string } | null>(null);
  useEffect(() => {
    fetch("/api/news")
      .then((r) => (r.ok ? r.json() : { articles: [], fetchedAt: new Date().toISOString() }))
      .then((j) => setData({ articles: (j.articles ?? []).slice(0, 7), fetchedAt: j.fetchedAt }))
      .catch(() => setData({ articles: [], fetchedAt: new Date().toISOString() }));
  }, []);
  const now = data ? Date.parse(data.fetchedAt) : 0;

  return (
    <Card
      icon={Newspaper}
      tone="text-[#f472b6]"
      title="Latest headlines"
      action={
        <Link href="/news" className="flex items-center gap-1 text-xs text-accent hover:underline">
          All news <ArrowRight className="h-3 w-3" />
        </Link>
      }
    >
      {data == null ? (
        <Loading text="Crawling news sources…" />
      ) : data.articles.length === 0 ? (
        <Empty text="No headlines yet." />
      ) : (
        <ul className="space-y-3">
          {data.articles.map((a) => (
            <li key={a.id} className="flex gap-2.5">
              <span
                className={clsx(
                  "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                  a.sentiment === "positive" ? "bg-up" : a.sentiment === "negative" ? "bg-down" : "bg-muted",
                )}
              />
              <div className="min-w-0">
                <a href={a.link} target="_blank" rel="noopener noreferrer" className="line-clamp-2 text-sm leading-snug hover:text-accent">
                  {a.title}
                </a>
                <p className="mt-0.5 text-[11px] text-muted">
                  {a.source} · {ago(a.publishedAt, now)} ago
                  {a.symbols.length > 0 && ` · ${a.symbols.slice(0, 3).map(short).join(", ")}`}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ------------------------------- helpers ------------------------------- */

function Loading({ text = "Loading…" }: { text?: string }) {
  return (
    <p className="flex items-center gap-2 py-4 text-xs text-muted">
      <Loader2 className="h-4 w-4 animate-spin" /> {text}
    </p>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <p className="flex items-center gap-2 py-4 text-xs text-muted">
      <Inbox className="h-4 w-4" /> {text}
    </p>
  );
}
