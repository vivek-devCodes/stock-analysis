import "server-only";
import { buildInsight } from "../analysis";
import { getFundamentalsFor, type Fundamentals } from "../fundamentals";
import { computeIndicators } from "../indicators";
import { getLiveQuotes } from "../live";
import { getNews, type NewsArticle } from "../news/aggregate";
import { scanIntraday, scanLongTerm, scanShortTerm, type Scan } from "../screener";
import { SECTORS } from "../stock-universe";
import type { Candle, Indicators, Insight, LiveQuote, NewsItem } from "../types";
import { fetchChart, fetchNews } from "../yahoo";
import type { Horizon, SourceRef } from "./types";

/**
 * Stage 1 — Data collection and validation. Everything downstream works from this snapshot,
 * so every value carries where it came from and how fresh it is. Nothing is invented: a
 * failed fetch is recorded as an error and the relevant agent reports insufficient data.
 */

export type MacroSeries = { symbol: string; label: string; last: number; change20dPct: number | null; asOf: string };

export type DataSnapshot = {
  symbol: string;
  name: string;
  exchange: string;
  sector: string;
  currency: string;
  horizon: Horizon;
  fetchedAt: string;
  live: LiveQuote | null;
  daily: Candle[];
  weekly: Candle[];
  ind: Indicators | null;
  insight: Insight | null;
  intraday: Scan | null;
  swing: Scan | null;
  longTerm: Scan | null;
  fundamentals: Fundamentals | null;
  articles: NewsArticle[];
  yahooNews: NewsItem[];
  nifty: Candle[];
  sectorIndex: { symbol: string; candles: Candle[] } | null;
  vix: number | null;
  macro: MacroSeries[];
  errors: string[];
  sources: SourceRef[];
};

const SECTOR_OF = new Map<string, string>();
for (const [sector, list] of Object.entries(SECTORS)) for (const s of list) if (!SECTOR_OF.has(s)) SECTOR_OF.set(s, sector);

/** Verified Yahoo symbols for NSE sector indices (^CNXFIN only returns one bar, so Finance uses the .NS one). */
const SECTOR_INDEX: Record<string, string> = {
  Banking: "^NSEBANK",
  IT: "^CNXIT",
  Pharma: "^CNXPHARMA",
  Auto: "^CNXAUTO",
  FMCG: "^CNXFMCG",
  Energy: "^CNXENERGY",
  Metal: "^CNXMETAL",
  Realty: "^CNXREALTY",
  Infra: "^CNXINFRA",
  Finance: "NIFTY_FIN_SERVICE.NS",
};

const MACRO: Array<{ symbol: string; label: string }> = [
  { symbol: "INR=X", label: "USD/INR" },
  { symbol: "BZ=F", label: "Brent crude" },
  { symbol: "GC=F", label: "Gold" },
  { symbol: "^GSPC", label: "S&P 500" },
  { symbol: "ES=F", label: "US futures (S&P)" },
  { symbol: "^TNX", label: "US 10-yr yield" },
];

/** "reliance" → "RELIANCE.NS"; keeps explicit suffixes (.NS/.BO), indices (^) and other tickers. */
export function normaliseSymbol(input: string): string {
  const s = input.trim().toUpperCase().replace(/\s+/g, "");
  if (!s) return s;
  if (s.startsWith("^") || s.includes(".") || s.includes("=") || s.includes("-")) return s;
  return `${s}.NS`;
}

const iso = (unix: number) => new Date(unix * 1000).toISOString();

async function settle<T>(label: string, errors: string[], p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

function change20(candles: Candle[]): number | null {
  if (candles.length < 21) return null;
  const last = candles.at(-1)!.close;
  const prev = candles.at(-21)!.close;
  return prev ? ((last - prev) / prev) * 100 : null;
}

export async function collectData(rawSymbol: string, horizon: Horizon): Promise<DataSnapshot> {
  const symbol = normaliseSymbol(rawSymbol);
  const errors: string[] = [];
  const sources: SourceRef[] = [];
  const sector = SECTOR_OF.get(symbol) ?? "Other";
  const sectorSym = SECTOR_INDEX[sector];

  const [dailyRes, weeklyRes, liveRes, scanRes, fundamentals, news, niftyRes, sectorRes, vixRes, macroRes] = await Promise.all([
    settle("Daily candles", errors, fetchChart(symbol, "2y", "1d")),
    settle("Weekly candles", errors, fetchChart(symbol, "5y", "1wk")),
    settle("Live quote", errors, getLiveQuotes([symbol]).then((q) => q[0] ?? null)),
    settle(
      "Horizon scan",
      errors,
      horizon === "intraday" ? scanIntraday(symbol) : horizon === "swing" ? scanShortTerm(symbol) : scanLongTerm(symbol),
    ),
    settle("Fundamentals", errors, getFundamentalsFor(symbol)),
    settle("News crawl", errors, getNews()),
    settle("Nifty 50", errors, fetchChart("^NSEI", "1y", "1d")),
    sectorSym ? settle("Sector index", errors, fetchChart(sectorSym, "6mo", "1d")) : Promise.resolve(null),
    settle("India VIX", errors, fetchChart("^INDIAVIX", "1mo", "1d")),
    Promise.all(MACRO.map((m) => settle(m.label, errors, fetchChart(m.symbol, "3mo", "1d")))),
  ]);

  const daily = dailyRes?.candles ?? [];
  const quote = dailyRes?.quote;
  const name = quote?.name ?? symbol;
  const yahooNews = (await settle("Yahoo news", errors, fetchNews(symbol, name))) ?? [];

  let ind: Indicators | null = null;
  let insight: Insight | null = null;
  if (daily.length >= 60 && quote) {
    const window = daily.slice(-300);
    ind = computeIndicators(window);
    insight = buildInsight({ ...quote, price: liveRes?.price ?? quote.price }, window, ind, yahooNews);
  }

  const articles = (news?.articles ?? []).filter((a) => a.symbols.includes(symbol));

  if (dailyRes) {
    sources.push({ name: "Yahoo Finance — daily OHLCV", kind: "vendor", timestamp: daily.length ? iso(daily.at(-1)!.time) : undefined, note: "end of day; NSE/BSE intraday 15-min delayed" });
  }
  if (liveRes) sources.push({ name: liveRes.source, kind: liveRes.source.startsWith("NSE") ? "exchange" : "vendor", timestamp: iso(liveRes.time), note: `market ${liveRes.marketState.toLowerCase()}` });
  if (fundamentals) sources.push({ name: "Yahoo Finance — fundamentals (quoteSummary)", kind: "vendor", note: "TTM ratios; growth = latest quarter YoY" });
  if (news) sources.push({ name: `News crawler — ${news.sources.filter((s) => s.ok).length} feeds`, kind: "media", timestamp: news.fetchedAt, note: "RSS; robots.txt-compliant" });
  if (niftyRes) sources.push({ name: "Yahoo Finance — NIFTY 50, India VIX, sector & macro series", kind: "vendor", timestamp: niftyRes.candles.length ? iso(niftyRes.candles.at(-1)!.time) : undefined });

  const macro: MacroSeries[] = [];
  MACRO.forEach((m, i) => {
    const r = macroRes[i];
    if (r && r.candles.length) macro.push({ symbol: m.symbol, label: m.label, last: r.quote.price, change20dPct: change20(r.candles), asOf: iso(r.candles.at(-1)!.time) });
  });

  return {
    symbol,
    name,
    exchange: quote?.exchange || (symbol.endsWith(".BO") ? "BSE" : "NSE"),
    sector,
    currency: quote?.currency ?? "INR",
    horizon,
    fetchedAt: new Date().toISOString(),
    live: liveRes,
    daily,
    weekly: weeklyRes?.candles ?? [],
    ind,
    insight,
    intraday: horizon === "intraday" ? scanRes : null,
    swing: horizon === "swing" ? scanRes : null,
    longTerm: horizon === "long-term" ? scanRes : null,
    fundamentals,
    articles,
    yahooNews,
    nifty: niftyRes?.candles ?? [],
    sectorIndex: sectorSym && sectorRes ? { symbol: sectorSym, candles: sectorRes.candles } : null,
    vix: vixRes?.quote.price ?? null,
    macro,
    errors,
    sources,
  };
}

/** Stage 1 verdict: can we analyse this instrument at all? */
export function validateData(d: DataSnapshot): { ok: boolean; problems: string[]; warnings: string[] } {
  const problems: string[] = [];
  const warnings: string[] = [];
  if (d.daily.length < 60) problems.push(`Not enough verified price history for ${d.symbol} (need ≥ 60 daily candles, got ${d.daily.length}).`);
  if (d.daily.length) {
    const ageDays = (Date.now() / 1000 - d.daily.at(-1)!.time) / 86400;
    if (ageDays > 6) problems.push(`Latest daily candle is ${ageDays.toFixed(0)} days old — data is stale.`);
  }
  if (!d.live) warnings.push("No live quote; using the last daily close.");
  if (d.horizon === "intraday" && !d.intraday) problems.push("No intraday candles available for this instrument.");
  if (!d.fundamentals) warnings.push("Fundamentals unavailable.");
  for (const e of d.errors) warnings.push(e);
  return { ok: problems.length === 0, problems, warnings };
}
