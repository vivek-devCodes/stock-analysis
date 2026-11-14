"use client";

import { Bell, Loader2, Mail, Plus, Search, Sparkles, Star, Trash2, TrendingDown, TrendingUp, X } from "lucide-react";
import { INDEX_LABELS, useMarket } from "./shell/market-store";
import { WatchlistAdder } from "./WatchlistAdder";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PriceChart } from "@/components/PriceChart";
import { clsx, formatNumber, formatPercent, formatPrice } from "@/lib/format";
import type { AlertEvent, AlertRule, AnalyzeResponse, LiveQuote, SearchResult } from "@/lib/types";
import { LiveBadge } from "./LiveBadge";
import { TermLabel } from "./TermLabel";
import { TrackBadge } from "./TrackBadge";
import { ChartControls, SignalLegend } from "./ChartControls";
import { DEFAULT_SIGNALS, DEFAULT_STUDIES, type SignalId, type StudyId } from "@/lib/chart-config";
import { StockInsightPanel } from "./insights/StockInsightPanel";

const LIVE_POLL_MS = 10_000;
import { ALERT_KEY, EVENT_KEY, loadJson, loadWatchlist, saveJson, saveWatchlist } from "@/lib/watchlist";

const RANGES = ["1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y"] as const;
function toneClass(tone: string) {
  if (tone === "bullish" || tone === "BUY" || tone === "positive" || tone === "up") {
    return "bg-up/15 text-up";
  }
  if (tone === "bearish" || tone === "SELL" || tone === "negative" || tone === "down") {
    return "bg-down/15 text-down";
  }
  if (tone === "warning") return "bg-warn/15 text-warn";
  return "bg-white/8 text-muted";
}

export function Dashboard({ initialSymbol }: { initialSymbol: string }) {
  const [symbol, setSymbol] = useState(initialSymbol);
  const [range, setRange] = useState("1y");
  const [studies, setStudies] = useState<StudyId[]>(DEFAULT_STUDIES);
  const [signals, setSignals] = useState<SignalId[]>(DEFAULT_SIGNALS);
  const [data, setData] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [live, setLive] = useState<LiveQuote | null>(null);
  const { quotes: marketQuotes } = useMarket();
  const [watchlist, setWatchlist] = useState<string[]>(loadWatchlist);
  const [alerts, setAlerts] = useState<AlertRule[]>([]);
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [alertOpen, setAlertOpen] = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportStatus, setReportStatus] = useState<string | null>(null);
  const [testEmailLoading, setTestEmailLoading] = useState(false);
  const searchTimer = useRef<number | null>(null);

  useEffect(() => {
    setWatchlist(loadWatchlist());
    setAlerts(loadJson<AlertRule[]>(ALERT_KEY, []));
    setEvents(loadJson<AlertEvent[]>(EVENT_KEY, []));
  }, []);

  /** silent = background refresh: no spinner, and keep the current data if it fails. */
  const load = useCallback(async (sym: string, rng: string, silent = false) => {
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const res = await fetch(`/api/analyze?symbol=${encodeURIComponent(sym)}&range=${rng}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Analyze failed");
      setData(json);
      setSymbol(json.quote.symbol);
      const url = new URL(window.location.href);
      url.searchParams.set("symbol", json.quote.symbol);
      window.history.replaceState({}, "", url);
    } catch (err) {
      if (silent) return;
      setError(err instanceof Error ? err.message : "Unable to load symbol");
      setData(null);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(symbol, range);
    // Re-pull candles + indicators in the background: often for intraday ranges, rarely otherwise.
    const every = range === "1d" || range === "5d" ? 2 * 60_000 : 10 * 60_000;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(symbol, range, true);
    }, every);
    return () => window.clearInterval(id);
  }, [load, symbol, range]);

  // Live price for the open symbol every 10 s; it moves the header price and the last candle.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      const res = await fetch(`/api/live?symbols=${encodeURIComponent(symbol)}`).catch(() => null);
      const json = res?.ok ? await res.json() : null;
      const q = (json?.quotes as LiveQuote[] | undefined)?.[0];
      if (!cancelled && q) setLive(q);
    };
    void tick();
    const id = window.setInterval(tick, LIVE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [symbol]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(async () => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      const json = await res.json();
      setResults(json.results ?? []);
    }, 220);
  }, [query]);

  const pushEvent = useCallback((event: AlertEvent) => {
    setEvents((prev) => {
      const next = [event, ...prev].slice(0, 40);
      saveJson(EVENT_KEY, next);
      return next;
    });
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(`${event.symbol} alert`, { body: event.message });
    }
  }, []);

  const alertsRef = useRef(alerts);
  alertsRef.current = alerts;

  useEffect(() => {
    const poll = async () => {
      const enabled = alertsRef.current.filter((a) => a.enabled);
      if (!enabled.length) return;
      const unique = [...new Set(enabled.map((a) => a.symbol))];
      const quotes = await Promise.all(
        unique.map(async (sym) => {
          const res = await fetch(`/api/quote?symbol=${encodeURIComponent(sym)}`);
          const json = await res.json();
          return json.quote as AnalyzeResponse["quote"] | undefined;
        }),
      );
      setAlerts((current) => {
        const next = current.map((rule) => {
          const quoteSnap = quotes.find((q) => q?.symbol === rule.symbol);
          if (!quoteSnap || !rule.enabled) return rule;
          const cooldown = rule.lastTriggeredAt
            ? Date.now() - new Date(rule.lastTriggeredAt).getTime() < 15 * 60 * 1000
            : false;
          if (cooldown) return rule;
          let hit = false;
          let message = "";
          if (rule.type === "price_above" && quoteSnap.price >= rule.value) {
            hit = true;
            message = `${quoteSnap.symbol} crossed above ${rule.value}`;
          }
          if (rule.type === "price_below" && quoteSnap.price <= rule.value) {
            hit = true;
            message = `${quoteSnap.symbol} fell below ${rule.value}`;
          }
          if (rule.type === "pct_change" && Math.abs(quoteSnap.changePercent) >= rule.value) {
            hit = true;
            message = `${quoteSnap.symbol} moved ${quoteSnap.changePercent.toFixed(2)}%`;
          }
          if (
            rule.type === "volume_spike" &&
            quoteSnap.averageVolume &&
            quoteSnap.volume / quoteSnap.averageVolume >= rule.value
          ) {
            hit = true;
            message = `${quoteSnap.symbol} volume is ${(quoteSnap.volume / quoteSnap.averageVolume).toFixed(1)}x average`;
          }
          if (rule.type === "volatility_spike" && Math.abs(quoteSnap.changePercent) >= rule.value) {
            hit = true;
            message = `${quoteSnap.symbol} session move ${quoteSnap.changePercent.toFixed(2)}% exceeds volatility threshold`;
          }
          if (!hit) return rule;
          pushEvent({
            id: crypto.randomUUID(),
            ruleId: rule.id,
            symbol: rule.symbol,
            message,
            at: new Date().toISOString(),
            severity: rule.type.includes("price") ? "warning" : "info",
          });
          return { ...rule, lastTriggeredAt: new Date().toISOString() };
        });
        saveJson(ALERT_KEY, next);
        return next;
      });
    };
    void poll();
    const id = window.setInterval(poll, 45_000);
    return () => window.clearInterval(id);
  }, [pushEvent]);

  const persistWatchlist = (next: string[]) => {
    setWatchlist(next);
    saveWatchlist(next);
  };

  const onSearch = (event: FormEvent) => {
    event.preventDefault();
    const next = query.trim().toUpperCase();
    if (!next) return;
    setSymbol(next);
    setQuery("");
    setResults([]);
  };

  const addAlert = (partial: Omit<AlertRule, "id" | "createdAt" | "lastTriggeredAt" | "enabled">) => {
    const rule: AlertRule = {
      ...partial,
      id: crypto.randomUUID(),
      enabled: true,
      createdAt: new Date().toISOString(),
      lastTriggeredAt: null,
    };
    const next = [rule, ...alerts];
    setAlerts(next);
    saveJson(ALERT_KEY, next);
    if ("Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission();
    }
  };

  const quote = data?.quote;
  // Only trust a live tick for the symbol that's on screen.
  const liveQuote = live && quote && live.symbol === quote.symbol ? live : null;
  const shown = liveQuote ?? quote ?? { price: 0, change: 0, changePercent: 0 };
  const up = shown.changePercent >= 0;

  const metrics = useMemo(() => {
    if (!data) return [];
    return [
      ["Open", formatPrice(data.quote.open, data.quote.currency)],
      ["High", formatPrice(data.quote.dayHigh, data.quote.currency)],
      ["Low", formatPrice(data.quote.dayLow, data.quote.currency)],
      ["Volume", formatNumber(data.quote.volume, 0)],
      ["Mkt cap", formatNumber(data.quote.marketCap)],
      ["P/E", formatNumber(data.quote.pe)],
      ["EPS", formatNumber(data.quote.eps)],
      ["Beta", formatNumber(data.quote.beta)],
      ["52W high", formatNumber(data.quote.fiftyTwoWeekHigh)],
      ["52W low", formatNumber(data.quote.fiftyTwoWeekLow)],
      ["RSI", formatNumber(data.indicators.rsi, 1)],
      ["ATR %", data.indicators.atrPercent ? `${data.indicators.atrPercent.toFixed(2)}%` : "—"],
      ["RV (ann.)", data.indicators.realizedVol ? `${data.indicators.realizedVol.toFixed(1)}%` : "—"],
      ["Vol ratio", formatNumber(data.indicators.volumeRatio, 2)],
    ];
  }, [data]);

  return (
    <div>
      <div className="space-y-3 border-b border-line px-4 pb-3 pt-4">
        <div className="flex gap-2 overflow-x-auto pb-1 text-xs">
          {marketQuotes.map((idx) => (
            <button
              key={idx.symbol}
              onClick={() => setSymbol(idx.symbol)}
              className={clsx(
                "flex shrink-0 items-center gap-2 rounded-lg border px-2.5 py-1.5",
                idx.symbol === symbol ? "border-accent/60 bg-accent/10" : "border-line bg-card hover:bg-white/5",
              )}
            >
              <LiveBadge quote={idx} compact />
              <span className="text-muted">{INDEX_LABELS[idx.symbol] ?? idx.symbol}</span>
              <span className="font-mono">{idx.price.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
              <span className={idx.changePercent >= 0 ? "text-up" : "text-down"}>{formatPercent(idx.changePercent)}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
        <form onSubmit={onSearch} className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search any symbol — RELIANCE.NS, TCS.NS, AAPL, BTC-USD"
            className="w-full rounded-xl border border-line bg-card px-9 py-2 text-sm outline-none ring-accent/40 placeholder:text-muted focus:ring-2"
          />
          {results.length > 0 && (
            <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-line bg-[#121821] shadow-2xl">
              {results.map((item) => (
                <button
                  key={item.symbol}
                  type="button"
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-white/5"
                  onClick={() => {
                    setSymbol(item.symbol);
                    setQuery("");
                    setResults([]);
                  }}
                >
                  <span>
                    <span className="font-semibold">{item.symbol}</span>
                    <span className="ml-2 text-muted">{item.name}</span>
                  </span>
                  <span className="text-[11px] text-muted">{item.exchange}</span>
                </button>
              ))}
            </div>
          )}
        </form>
        <button
          onClick={() => setAlertOpen(true)}
          className="inline-flex items-center gap-2 rounded-xl border border-line bg-card px-3 py-2 text-sm hover:bg-white/5"
        >
          <Bell className="h-4 w-4 text-warn" />
          Alerts
          {events.length > 0 && (
            <span className="rounded-full bg-down px-1.5 text-[10px] text-white">{events.length}</span>
          )}
        </button>
        <button
          onClick={() => setReportModalOpen(true)}
          className="inline-flex items-center gap-2 rounded-xl border border-accent/40 bg-accent/10 px-3 py-2 text-sm font-medium text-accent hover:bg-accent/20 transition-colors"
        >
          <Mail className="h-4 w-4" />
          Daily AI Report
        </button>
        </div>
      </div>

      <div className="grid gap-4 p-4 xl:grid-cols-[240px_minmax(0,1fr)_320px]">
        <aside className="panel h-fit p-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Watchlist</h2>
            {quote && (
              <button
                className="text-accent"
                onClick={() => {
                  if (watchlist.includes(quote.symbol)) {
                    persistWatchlist(watchlist.filter((s) => s !== quote.symbol));
                  } else {
                    persistWatchlist([quote.symbol, ...watchlist]);
                  }
                }}
              >
                <Star className={clsx("h-4 w-4", watchlist.includes(quote.symbol) && "fill-warn text-warn")} />
              </button>
            )}
          </div>
          <WatchlistAdder
            watchlist={watchlist}
            onAdd={(sym) => {
              if (!watchlist.includes(sym)) persistWatchlist([sym, ...watchlist]);
              setSymbol(sym);
            }}
          />
          <div className="space-y-1">
            {watchlist.map((item) => (
              <button
                key={item}
                onClick={() => setSymbol(item)}
                className={clsx(
                  "flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm",
                  item === symbol ? "bg-accent/15 text-accent" : "hover:bg-white/5",
                )}
              >
                {item}
                <X
                  className="h-3.5 w-3.5 text-muted"
                  onClick={(e) => {
                    e.stopPropagation();
                    persistWatchlist(watchlist.filter((s) => s !== item));
                  }}
                />
              </button>
            ))}
          </div>
        </aside>

        <main className="space-y-4">
          {error && (
            <div className="panel border-down/40 p-4 text-sm text-down">{error}. Try a Yahoo-listed ticker such as RELIANCE.NS or AAPL.</div>
          )}
          {loading && !data && (
            <div className="panel flex h-80 items-center justify-center gap-2 text-muted">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading market data…
            </div>
          )}
          {data && quote && (
            <>
              <section className="panel p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h1 className="text-2xl font-semibold">{quote.symbol}</h1>
                      <span className="chip bg-white/8 text-muted">{quote.exchange}</span>
                      {liveQuote ? <LiveBadge quote={liveQuote} /> : <span className="chip bg-white/8 text-muted">{quote.marketState}</span>}
                    </div>
                    <p className="text-sm text-muted">
                      {quote.name}
                      {quote.sector ? ` · ${quote.sector}` : ""}
                      {quote.industry ? ` · ${quote.industry}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-3xl font-semibold">{formatPrice(shown.price, quote.currency)}</p>
                    <p className={clsx("flex items-center justify-end gap-1 text-sm", up ? "text-up" : "text-down")}>
                      {up ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                      {formatPrice(shown.change, quote.currency)} ({formatPercent(shown.changePercent)})
                    </p>
                    {liveQuote && (
                      <p className="mt-0.5 text-[11px] text-muted">
                        {liveQuote.source} · last trade{" "}
                        {new Date(liveQuote.time * 1000).toLocaleString("en-IN", {
                          timeZone: "Asia/Kolkata",
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}{" "}
                        IST
                      </p>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {data.insight.signals.map((signal) => (
                    <span key={signal.id + signal.label} className={clsx("chip", toneClass(signal.tone))} title={signal.detail}>
                      {signal.label}
                    </span>
                  ))}
                  <span className={clsx("chip", toneClass(data.insight.recommendation))}>
                    {data.insight.recommendation}
                  </span>
                  <span className={clsx("chip", toneClass(data.newsSentiment.label))}>
                    News {data.newsSentiment.label}
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                  {metrics.map(([label, value]) => (
                    <div key={label} className="rounded-lg bg-white/3 px-2 py-1.5">
                      <p className="text-[10px] uppercase tracking-wider text-muted"><TermLabel label={label} /></p>
                      <p className="font-mono text-sm">{value}</p>
                    </div>
                  ))}
                </div>
              </section>

              <section className="panel p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex gap-1">
                    {RANGES.map((item) => (
                      <button
                        key={item}
                        onClick={() => setRange(item)}
                        className={clsx(
                          "rounded-lg px-2 py-1 text-xs font-semibold uppercase",
                          range === item ? "bg-accent text-white" : "text-muted hover:bg-white/5",
                        )}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                  <ChartControls studies={studies} signals={signals} onStudies={setStudies} onSignals={setSignals} intraday={data.interval !== "1d" && data.interval !== "1wk"} />
                </div>
                {loading && (
                  <div className="mb-2 flex items-center gap-2 text-xs text-muted">
                    <Loader2 className="h-3 w-3 animate-spin" /> Refreshing {range}…
                  </div>
                )}
                <PriceChart data={data} studies={studies} signals={signals} live={liveQuote} />
                <SignalLegend signals={signals} intraday={data.interval !== "1d" && data.interval !== "1wk"} />
              </section>

              <section className="panel p-4">
                <h2 className="text-sm font-semibold">Comprehensive analysis</h2>
                <p className="mt-1 text-sm text-muted">{data.insight.summary}</p>
                <div className="mt-4 grid gap-4 md:grid-cols-3">
                  <div>
                    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-up">What is working</h3>
                    <ul className="mt-2 space-y-1 text-sm">
                      {data.insight.working.map((item) => (
                        <li key={item}>• {item}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-down">What is not</h3>
                    <ul className="mt-2 space-y-1 text-sm">
                      {data.insight.notWorking.map((item) => (
                        <li key={item}>• {item}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-warn">Risks</h3>
                    <ul className="mt-2 space-y-1 text-sm">
                      {data.insight.risks.map((item) => (
                        <li key={item}>• {item}</li>
                      ))}
                    </ul>
                  </div>
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div>
                    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Support / resistance</h3>
                    <p className="mt-2 text-sm">
                      Support: {data.insight.support.map((v) => v.toFixed(2)).join(" · ") || "—"}
                    </p>
                    <p className="text-sm">
                      Resistance: {data.insight.resistance.map((v) => v.toFixed(2)).join(" · ") || "—"}
                    </p>
                  </div>
                  <div>
                    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Reasoning</h3>
                    <ul className="mt-2 space-y-1 text-sm text-muted">
                      {data.insight.reasoning.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </section>

              <section className="panel p-4">
                <h2 className="text-sm font-semibold">News and sentiment</h2>
                <div className="mt-3 space-y-3">
                  {data.news.length === 0 && <p className="text-sm text-muted">No recent headlines for this symbol.</p>}
                  {data.news.map((item) => (
                    <a
                      key={item.link + item.title}
                      href={item.link}
                      target="_blank"
                      rel="noreferrer"
                      className="block rounded-lg border border-line p-3 hover:bg-white/4"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className={clsx("chip", toneClass(item.sentiment))}>{item.sentiment}</span>
                        <span className="text-[11px] text-muted">
                          {item.publisher} · {new Date(item.publishedAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="mt-1 text-sm">{item.title}</p>
                    </a>
                  ))}
                </div>
              </section>
            </>
          )}
        </main>

        <aside className="space-y-4">
          {data && (
            <>
              <section className="panel p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Swing setup (1–2 weeks)</p>
                <p className={clsx("mt-2 text-3xl font-semibold", toneClass(data.insight.recommendation).split(" ")[1])}>
                  {data.insight.recommendation}
                </p>
                <p className="mt-1 text-sm">{data.insight.headline}</p>
                <p className="mt-1 text-xs text-muted">Setup score {data.insight.score > 0 ? `+${data.insight.score}` : data.insight.score}</p>
                {data.insight.recommendation !== "HOLD" && (
                  <div className="mt-3">
                    <TrackBadge track={data.insight.track} detailed />
                  </div>
                )}
              </section>

              <StockInsightPanel key={data.quote.symbol} symbol={data.quote.symbol} defaultOpen />

              <section className="panel p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                  Expected range · next {data.forecast.horizon} bars
                </p>
                <p className="mt-2 font-mono text-xl">
                  <span className="text-down">{formatPrice(data.forecast.bandLow, data.quote.currency)}</span>
                  <span className="text-muted"> – </span>
                  <span className="text-up">{formatPrice(data.forecast.bandHigh, data.quote.currency)}</span>
                </p>
                <p className="mt-1 text-xs text-muted">
                  ±{(((data.forecast.bandHigh / data.forecast.expectedPrice - 1) * 100)).toFixed(1)}% around today&apos;s price ·
                  about 8 in 10 outcomes land inside it (measured 77–80%)
                </p>
                <p className="mt-3 text-[11px] leading-5 text-muted">{data.forecast.method}</p>
                <p className="mt-2 text-[11px] text-warn">{data.forecast.disclaimer}</p>
              </section>

              <section className="panel p-4">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Quick alert</p>
                  <button onClick={() => setAlertOpen(true)} className="text-xs text-accent">
                    Manage
                  </button>
                </div>
                <button
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-line py-2 text-sm"
                  onClick={() =>
                    addAlert({
                      symbol: data.quote.symbol,
                      type: "pct_change",
                      value: 3,
                    })
                  }
                >
                  <Plus className="h-4 w-4" /> 3% move on {data.quote.symbol}
                </button>
                <button
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-line py-2 text-sm"
                  onClick={() =>
                    addAlert({
                      symbol: data.quote.symbol,
                      type: "volume_spike",
                      value: 2,
                    })
                  }
                >
                  <Plus className="h-4 w-4" /> 2x volume spike
                </button>
              </section>

              <section className="panel p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Data source</p>
                <p className="mt-2 text-xs leading-5 text-muted">{data.provider}</p>
                <p className="mt-2 text-xs leading-5 text-muted">
                  NSE/BSE names use Yahoo suffixes (.NS / .BO). Official NSE, Zerodha Kite, and Groww APIs need
                  broker keys and are not bundled. Optional keys can be added later without changing the UI.
                </p>
              </section>
            </>
          )}
        </aside>
      </div>

      {alertOpen && (
        <AlertModal
          symbol={symbol}
          price={quote?.price ?? 0}
          alerts={alerts}
          events={events}
          onClose={() => setAlertOpen(false)}
          onAdd={addAlert}
          onToggle={(id) => {
            const next = alerts.map((a) => (a.id === id ? { ...a, enabled: !a.enabled } : a));
            setAlerts(next);
            saveJson(ALERT_KEY, next);
          }}
          onDelete={(id) => {
            const next = alerts.filter((a) => a.id !== id);
            setAlerts(next);
            saveJson(ALERT_KEY, next);
          }}
          onClearEvents={() => {
            setEvents([]);
            saveJson(EVENT_KEY, []);
          }}
        />
      )}

      {reportModalOpen && (
        <DailyReportModal
          watchlist={watchlist}
          onClose={() => setReportModalOpen(false)}
          loading={reportLoading}
          status={reportStatus}
          testEmailLoading={testEmailLoading}
          onTrigger={async () => {
            setReportLoading(true);
            setReportStatus("Collecting NSE/BSE & Yahoo data, calculating indicators, running Gemini 2.5 Flash deep analysis...");
            try {
              const res = await fetch("/api/daily-report", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ watchlist }),
              });
              const json = await res.json();
              if (json.success) {
                setReportStatus("✅ Report generated and email dispatched to configured recipients successfully!");
              } else {
                setReportStatus(`❌ Report failed: ${json.error || "Unknown error"}`);
              }
            } catch (err) {
              setReportStatus(`❌ Error: ${err instanceof Error ? err.message : String(err)}`);
            } finally {
              setReportLoading(false);
            }
          }}
          onTestEmail={async () => {
            setTestEmailLoading(true);
            setReportStatus("Testing SMTP email credentials...");
            try {
              const res = await fetch("/api/daily-report?action=test-email");
              const json = await res.json();
              if (json.success) {
                setReportStatus("✅ SMTP email connection verified successfully! Emails can be delivered.");
              } else {
                setReportStatus(`❌ SMTP connection failed: ${json.error || json.message}`);
              }
            } catch (err) {
              setReportStatus(`❌ Test failed: ${err instanceof Error ? err.message : String(err)}`);
            } finally {
              setTestEmailLoading(false);
            }
          }}
        />
      )}
    </div>
  );
}

function AlertModal({
  symbol,
  price,
  alerts,
  events,
  onClose,
  onAdd,
  onToggle,
  onDelete,
  onClearEvents,
}: {
  symbol: string;
  price: number;
  alerts: AlertRule[];
  events: AlertEvent[];
  onClose: () => void;
  onAdd: (rule: Omit<AlertRule, "id" | "createdAt" | "lastTriggeredAt" | "enabled">) => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onClearEvents: () => void;
}) {
  const [type, setType] = useState<AlertRule["type"]>("price_above");
  const [value, setValue] = useState(price);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
      <div className="panel max-h-[90vh] w-full max-w-xl overflow-auto p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Alerts</h2>
          <button onClick={onClose}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_120px_auto]">
          <select
            value={type}
            onChange={(e) => setType(e.target.value as AlertRule["type"])}
            className="rounded-lg border border-line bg-[#0e141c] px-2 py-2 text-sm"
          >
            <option value="price_above">Price above</option>
            <option value="price_below">Price below</option>
            <option value="pct_change">Abs % change</option>
            <option value="volume_spike">Volume multiple</option>
            <option value="volatility_spike">Volatility %</option>
          </select>
          <input
            type="number"
            value={value}
            onChange={(e) => setValue(Number(e.target.value))}
            className="rounded-lg border border-line bg-[#0e141c] px-2 py-2 text-sm"
          />
          <button
            onClick={() => onAdd({ symbol, type, value })}
            className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white"
          >
            Add
          </button>
        </div>
        <div className="mt-4 space-y-2">
          {alerts.length === 0 && <p className="text-sm text-muted">No rules yet.</p>}
          {alerts.map((rule) => (
            <div key={rule.id} className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={rule.enabled} onChange={() => onToggle(rule.id)} />
                {rule.symbol} · {rule.type.replaceAll("_", " ")} · {rule.value}
              </label>
              <button onClick={() => onDelete(rule.id)}>
                <Trash2 className="h-4 w-4 text-muted" />
              </button>
            </div>
          ))}
        </div>
        <div className="mt-5 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Triggered</h3>
          <button onClick={onClearEvents} className="text-xs text-muted">
            Clear
          </button>
        </div>
        <div className="mt-2 space-y-2">
          {events.length === 0 && <p className="text-sm text-muted">No alerts fired yet. Polling runs every 45s.</p>}
          {events.map((event) => (
            <div key={event.id} className="rounded-lg bg-white/4 px-3 py-2 text-sm">
              <p>{event.message}</p>
              <p className="text-[11px] text-muted">{new Date(event.at).toLocaleString()}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DailyReportModal({
  watchlist,
  onClose,
  loading,
  status,
  testEmailLoading,
  onTrigger,
  onTestEmail,
}: {
  watchlist: string[];
  onClose: () => void;
  loading: boolean;
  status: string | null;
  testEmailLoading: boolean;
  onTrigger: () => void;
  onTestEmail: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="panel max-h-[90vh] w-full max-w-2xl overflow-auto p-6 border-accent/30 shadow-2xl">
        <div className="flex items-center justify-between border-b border-line pb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-accent" />
            <h2 className="text-lg font-semibold">AI Stock Recommendation Dispatcher</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-white/10">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 space-y-4 text-sm">
          <div className="rounded-xl bg-accent/10 border border-accent/20 p-4">
            <h3 className="font-semibold text-accent flex items-center gap-2">
              <Mail className="h-4 w-4" /> Gemini daily report (on demand)
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              Scheduled emails now come from the <strong>autonomous AI Analyst</strong>: a <strong>pre-market digest at 08:30 IST</strong> and a
              <strong> post-market digest at 16:15 IST</strong> (Mon–Fri), each with every decision, its evidence and the rules applied.
              This Gemini report runs <strong>on demand</strong> with the buttons below: it aggregates NSE/BSE and Yahoo Finance data across
              major sectors, computes indicators (RSI, MACD, Bollinger Bands, ATR, moving averages) and asks
              <strong> Google Gemini 2.5 Flash</strong> for intraday, short-term and long-term ideas, emailed to you.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-line bg-card p-3">
              <p className="text-xs font-semibold text-muted uppercase">What&apos;s Included in Email</p>
              <ul className="mt-2 space-y-1 text-xs text-foreground/80 list-disc list-inside">
                <li>Nifty 50, Sensex & Bank Nifty sentiment</li>
                <li>🎯 Top 3-5 Intraday stocks (Entry, Target, Stop Loss)</li>
                <li>📈 Top 3-5 Short-term swing picks (1-2 weeks)</li>
                <li>🏦 Top 3-5 Long-term value picks (3-6 months)</li>
                <li>🔴 Stocks to avoid &amp; high risk alerts</li>
                <li>📊 Sector rotation &amp; hot sector ranking</li>
              </ul>
            </div>

            <div className="rounded-xl border border-line bg-card p-3">
              <p className="text-xs font-semibold text-muted uppercase">Automation &amp; Config</p>
              <ul className="mt-2 space-y-1 text-xs text-foreground/80">
                <li>• <strong>Schedule:</strong> on demand (scheduled emails = AI Analyst digests, 08:30 &amp; 16:15 IST)</li>
                <li>• <strong>CLI Command:</strong> <code className="text-accent">npm run daily-report</code></li>
                <li>• <strong>Setup:</strong> Set <code className="text-warn">GEMINI_API_KEY</code> &amp; <code className="text-warn">SMTP_PASS</code> in <code className="text-muted">.env</code></li>
              </ul>
            </div>
          </div>

          <div className="rounded-xl border border-line bg-card p-3 text-xs">
            <p className="font-semibold uppercase text-muted">⭐ Your watchlist in the email</p>
            <p className="mt-1 text-foreground/80">
              &quot;Run &amp; Send Report Now&quot; includes your {watchlist.length} watchlist stocks. If this report is triggered
              without this browser (e.g. via its API), it reads the{" "}
              <code className="text-warn">WATCHLIST_SYMBOLS</code> environment variable on Vercel instead — paste this there:
            </p>
            <code className="mt-2 block select-all break-all rounded-lg bg-[#0a0f16] p-2 text-accent">
              {watchlist.join(",")}
            </code>
          </div>

          {status && (
            <div className="rounded-xl border border-line bg-[#0a0f16] p-3 text-xs leading-relaxed font-mono">
              {status}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <button
              onClick={onTestEmail}
              disabled={testEmailLoading || loading}
              className="inline-flex items-center gap-2 rounded-xl border border-line px-4 py-2 text-xs font-medium hover:bg-white/5 disabled:opacity-50"
            >
              {testEmailLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              Test Email Credentials
            </button>

            <button
              onClick={onTrigger}
              disabled={loading || testEmailLoading}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-xs font-semibold text-white shadow-lg shadow-accent/25 hover:bg-accent/90 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Analyzing &amp; Sending (takes ~30s)...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Run &amp; Send Report Now
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
