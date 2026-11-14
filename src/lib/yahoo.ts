import type { Candle, LiveQuote, NewsItem, Quote, SearchResult } from "./types";

const YAHOO_CHART = [
  "https://query1.finance.yahoo.com/v8/finance/chart",
  "https://query2.finance.yahoo.com/v8/finance/chart",
];
const YAHOO_SEARCH = [
  "https://query1.finance.yahoo.com/v1/finance/search",
  "https://query2.finance.yahoo.com/v1/finance/search",
];
const YAHOO_QUOTE = [
  "https://query1.finance.yahoo.com/v10/finance/quoteSummary",
  "https://query2.finance.yahoo.com/v10/finance/quoteSummary",
];

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "application/json,text/plain,*/*",
};

async function fetchJson(urls: string[]): Promise<unknown> {
  let lastError: Error | null = null;
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: HEADERS, cache: "no-store" });
      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status} for ${url}`);
        continue;
      }
      return await res.json();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw lastError ?? new Error("All Yahoo Finance endpoints failed");
}

/* ------------------------------------------------------------------ */
/*  Session: Yahoo's quote and quoteSummary endpoints need a cookie +  */
/*  "crumb" pair. Without it they answer 401 "Invalid Crumb".          */
/* ------------------------------------------------------------------ */

type YahooSession = { cookie: string; crumb: string };
const SESSION_TTL_MS = 30 * 60 * 1000;
let sessionPromise: Promise<YahooSession> | null = null;
let sessionCreatedAt = 0;

async function createSession(): Promise<YahooSession> {
  const res = await fetch("https://fc.yahoo.com/", { headers: HEADERS, redirect: "manual", cache: "no-store" });
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  if (!cookie) throw new Error("Yahoo did not return a session cookie");
  const crumbRes = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
    headers: { ...HEADERS, Accept: "text/plain", Cookie: cookie },
    cache: "no-store",
  });
  const crumb = (await crumbRes.text()).trim();
  if (!crumbRes.ok || !crumb || crumb.length > 40 || crumb.includes("<")) {
    throw new Error(`Yahoo crumb unavailable (HTTP ${crumbRes.status})`);
  }
  return { cookie, crumb };
}

function getSession(force = false): Promise<YahooSession> {
  if (!sessionPromise || force || Date.now() - sessionCreatedAt > SESSION_TTL_MS) {
    sessionCreatedAt = Date.now();
    sessionPromise = createSession().catch((error) => {
      sessionPromise = null;
      throw error;
    });
  }
  return sessionPromise;
}

/** GET a crumb-protected Yahoo endpoint; refreshes the session once if the crumb is rejected. */
async function fetchJsonWithCrumb(buildUrls: (crumb: string) => string[]): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const session = await getSession(attempt > 0);
    let unauthorized = false;
    let lastError: Error | null = null;
    for (const url of buildUrls(encodeURIComponent(session.crumb))) {
      try {
        const res = await fetch(url, { headers: { ...HEADERS, Cookie: session.cookie }, cache: "no-store" });
        if (res.status === 401 || res.status === 403) {
          unauthorized = true;
          continue;
        }
        if (!res.ok) {
          lastError = new Error(`HTTP ${res.status} for ${url.split("?")[0]}`);
          continue;
        }
        return await res.json();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }
    if (!unauthorized) throw lastError ?? new Error("Yahoo request failed");
  }
  throw new Error("Yahoo rejected the session crumb");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function raw(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const rec = asRecord(value);
  if (rec && typeof rec.raw === "number" && Number.isFinite(rec.raw)) return rec.raw;
  return null;
}

function str(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

export const RANGE_INTERVAL: Record<string, { interval: string }> = {
  "1d": { interval: "5m" },
  "5d": { interval: "15m" },
  "1mo": { interval: "1h" },
  "3mo": { interval: "1d" },
  "6mo": { interval: "1d" },
  "1y": { interval: "1d" },
  "2y": { interval: "1d" },
  "5y": { interval: "1wk" },
};

export async function searchSymbols(query: string): Promise<SearchResult[]> {
  const q = encodeURIComponent(query.trim());
  const data = (await fetchJson(
    YAHOO_SEARCH.map((base) => `${base}?q=${q}&quotesCount=12&newsCount=0&listsCount=0`),
  )) as { quotes?: Array<Record<string, unknown>> };

  return (data.quotes ?? [])
    .filter((item) => item.symbol)
    .map((item) => ({
      symbol: str(item.symbol),
      name: str(item.shortname || item.longname || item.symbol),
      exchange: str(item.exchDisp || item.exchange),
      type: str(item.quoteType || item.typeDisp, "EQUITY"),
    }));
}

export async function fetchChart(symbol: string, range = "1y") {
  const { interval } = RANGE_INTERVAL[range] ?? RANGE_INTERVAL["1y"];
  const encoded = encodeURIComponent(symbol);
  const data = (await fetchJson(
    YAHOO_CHART.map(
      (base) =>
        `${base}/${encoded}?range=${range}&interval=${interval}&includePrePost=false&events=div%2Csplit`,
    ),
  )) as { chart?: { result?: unknown[]; error?: unknown } };

  const result = data.chart?.result?.[0];
  const rec = asRecord(result);
  if (!rec) throw new Error(`No chart data for ${symbol}`);

  const meta = asRecord(rec.meta) ?? {};
  const timestamp = (rec.timestamp as number[] | undefined) ?? [];
  const indicators = asRecord(rec.indicators);
  const quoteList = indicators?.quote;
  const quotes = Array.isArray(quoteList) ? asRecord(quoteList[0]) : asRecord(quoteList);
  if (!quotes) throw new Error(`No quote series for ${symbol}`);

  const opens = (quotes.open as Array<number | null>) ?? [];
  const highs = (quotes.high as Array<number | null>) ?? [];
  const lows = (quotes.low as Array<number | null>) ?? [];
  const closes = (quotes.close as Array<number | null>) ?? [];
  const volumes = (quotes.volume as Array<number | null>) ?? [];

  const candles: Candle[] = [];
  for (let i = 0; i < timestamp.length; i += 1) {
    const open = opens[i];
    const high = highs[i];
    const low = lows[i];
    const close = closes[i];
    if (
      open == null ||
      high == null ||
      low == null ||
      close == null ||
      !Number.isFinite(open) ||
      !Number.isFinite(close)
    ) {
      continue;
    }
    candles.push({
      time: timestamp[i],
      open,
      high,
      low,
      close,
      volume: volumes[i] ?? 0,
    });
  }

  const last = candles.at(-1);
  const previousClose = Number(
    meta.regularMarketPreviousClose ??
      meta.previousClose ??
      candles.at(-2)?.close ??
      last?.close ??
      0,
  );
  const price = Number(meta.regularMarketPrice ?? last?.close ?? 0);
  const change = price - previousClose;
  const changePercent = previousClose ? (change / previousClose) * 100 : 0;

  const quote: Quote = {
    symbol: str(meta.symbol, symbol),
    name: str(meta.longName || meta.shortName, symbol),
    exchange: str(meta.fullExchangeName || meta.exchangeName),
    currency: str(meta.currency, "USD"),
    price,
    change,
    changePercent,
    previousClose,
    open: Number(meta.regularMarketOpen ?? last?.open ?? 0),
    dayHigh: Number(meta.regularMarketDayHigh ?? last?.high ?? 0),
    dayLow: Number(meta.regularMarketDayLow ?? last?.low ?? 0),
    volume: Number(meta.regularMarketVolume ?? last?.volume ?? 0),
    averageVolume: raw(meta.averageDailyVolume3Month) ?? null,
    marketCap: null,
    pe: null,
    eps: null,
    fiftyTwoWeekHigh: Number(meta.fiftyTwoWeekHigh ?? 0) || null,
    fiftyTwoWeekLow: Number(meta.fiftyTwoWeekLow ?? 0) || null,
    dividendYield: null,
    beta: null,
    sector: null,
    industry: null,
    marketState: str(meta.marketState, "REGULAR"),
  };

  return { quote, candles, interval, meta };
}

export async function enrichQuote(quote: Quote): Promise<Quote> {
  try {
    const encoded = encodeURIComponent(quote.symbol);
    const modules = "summaryDetail,defaultKeyStatistics,financialData,assetProfile,price";
    const data = (await fetchJsonWithCrumb((crumb) =>
      YAHOO_QUOTE.map((base) => `${base}/${encoded}?modules=${modules}&crumb=${crumb}`),
    )) as { quoteSummary?: { result?: Array<Record<string, unknown>> } };

    const result = data.quoteSummary?.result?.[0];
    if (!result) return quote;

    const summary = asRecord(result.summaryDetail) ?? {};
    const stats = asRecord(result.defaultKeyStatistics) ?? {};
    const financials = asRecord(result.financialData) ?? {};
    const profile = asRecord(result.assetProfile) ?? {};
    const price = asRecord(result.price) ?? {};

    return {
      ...quote,
      name: str(price.longName || price.shortName, quote.name),
      marketCap: raw(price.marketCap) ?? quote.marketCap,
      pe: raw(summary.trailingPE) ?? raw(stats.trailingPE) ?? quote.pe,
      eps: raw(stats.trailingEps) ?? quote.eps,
      dividendYield: raw(summary.dividendYield)
        ? (raw(summary.dividendYield) as number) * 100
        : quote.dividendYield,
      beta: raw(summary.beta) ?? quote.beta,
      averageVolume: raw(summary.averageVolume) ?? quote.averageVolume,
      fiftyTwoWeekHigh: raw(summary.fiftyTwoWeekHigh) ?? quote.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: raw(summary.fiftyTwoWeekLow) ?? quote.fiftyTwoWeekLow,
      sector: str(profile.sector) || quote.sector,
      industry: str(profile.industry) || quote.industry,
    };
  } catch {
    return quote;
  }
}

const POSITIVE = [
  "surge",
  "rally",
  "beat",
  "growth",
  "profit",
  "upgrade",
  "record",
  "strong",
  "bullish",
  "outperform",
  "buy",
  "gain",
  "expands",
  "wins",
  "optimistic",
];
const NEGATIVE = [
  "fall",
  "drop",
  "miss",
  "loss",
  "downgrade",
  "weak",
  "bearish",
  "underperform",
  "sell",
  "crash",
  "probe",
  "fraud",
  "lawsuit",
  "cut",
  "layoff",
  "warning",
  "slump",
];

export function scoreHeadline(title: string) {
  const text = title.toLowerCase();
  let score = 0;
  for (const word of POSITIVE) if (text.includes(word)) score += 1;
  for (const word of NEGATIVE) if (text.includes(word)) score -= 1;
  const sentiment = score > 0 ? "positive" : score < 0 ? "negative" : "neutral";
  return { sentiment, score } as const;
}

export async function fetchNews(symbol: string, name?: string): Promise<NewsItem[]> {
  const query = encodeURIComponent(name ? `${symbol} ${name}` : symbol);
  try {
    const data = (await fetchJson(
      YAHOO_SEARCH.map(
        (base) => `${base}?q=${query}&quotesCount=0&newsCount=14&listsCount=0`,
      ),
    )) as { news?: Array<Record<string, unknown>> };

    return (data.news ?? []).map((item) => {
      const title = str(item.title, "Untitled");
      const { sentiment, score } = scoreHeadline(title);
      const provider = asRecord(item.provider);
      return {
        title,
        publisher: str(provider?.displayName || item.publisher, "Yahoo Finance"),
        link: str(item.link),
        publishedAt: new Date(
          (typeof item.providerPublishTime === "number"
            ? item.providerPublishTime
            : Date.now() / 1000) * 1000,
        ).toISOString(),
        sentiment,
        score,
      };
    });
  } catch {
    return [];
  }
}

export async function fetchIndexQuotes(symbols: string[]) {
  const results = await Promise.allSettled(
    symbols.map(async (symbol) => {
      const { quote } = await fetchChart(symbol, "5d");
      return {
        symbol: quote.symbol,
        name: quote.name,
        price: quote.price,
        changePercent: quote.changePercent,
      };
    }),
  );
  return results
    .filter((item): item is PromiseFulfilledResult<{
      symbol: string;
      name: string;
      price: number;
      changePercent: number;
    }> => item.status === "fulfilled")
    .map((item) => item.value);
}

/* ------------------------------------------------------------------ */
/*  Batch live quotes (one request for many symbols)                   */
/* ------------------------------------------------------------------ */

const YAHOO_BATCH_QUOTE = [
  "https://query2.finance.yahoo.com/v7/finance/quote",
  "https://query1.finance.yahoo.com/v7/finance/quote",
];

export async function fetchQuotesBatch(symbols: string[]): Promise<LiveQuote[]> {
  if (!symbols.length) return [];
  const list = symbols.map(encodeURIComponent).join(",");
  const data = (await fetchJsonWithCrumb((crumb) =>
    YAHOO_BATCH_QUOTE.map((base) => `${base}?symbols=${list}&crumb=${crumb}`),
  )) as { quoteResponse?: { result?: Array<Record<string, unknown>> } };

  return (data.quoteResponse?.result ?? []).flatMap((q) => {
    const price = raw(q.regularMarketPrice);
    if (price == null) return [];
    const delay = raw(q.exchangeDataDelayedBy) ?? 0;
    return [
      {
        symbol: str(q.symbol),
        name: str(q.shortName || q.longName || q.symbol),
        price,
        change: raw(q.regularMarketChange) ?? 0,
        changePercent: raw(q.regularMarketChangePercent) ?? 0,
        previousClose: raw(q.regularMarketPreviousClose),
        open: raw(q.regularMarketOpen),
        dayHigh: raw(q.regularMarketDayHigh),
        dayLow: raw(q.regularMarketDayLow),
        volume: raw(q.regularMarketVolume),
        time: raw(q.regularMarketTime) ?? Math.floor(Date.now() / 1000),
        marketState: str(q.marketState, "REGULAR"),
        delayMinutes: delay,
        source: delay > 0 ? `Yahoo (${delay}-min delayed)` : "Yahoo (live)",
      },
    ];
  });
}

/** Raw quoteSummary modules for the fundamentals screener. */
export async function fetchQuoteSummary(symbol: string, modules: string): Promise<Record<string, unknown> | null> {
  const encoded = encodeURIComponent(symbol);
  const data = (await fetchJsonWithCrumb((crumb) =>
    YAHOO_QUOTE.map((base) => `${base}/${encoded}?modules=${modules}&crumb=${crumb}`),
  )) as { quoteSummary?: { result?: Array<Record<string, unknown>> } };
  return data.quoteSummary?.result?.[0] ?? null;
}

export { raw as yahooRaw, asRecord as yahooRecord };
