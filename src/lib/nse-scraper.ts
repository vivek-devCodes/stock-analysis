/**
 * NSE India unofficial JSON API scraper.
 *
 * The NSE website gates its JSON endpoints behind a session cookie that is
 * issued when you first visit the main page.  This module transparently
 * handles cookie acquisition, caching, and retry logic so that consumers
 * can simply call the exported helpers.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NSEStockData {
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  change: number;
  changePercent: number;
  volume: number;
  previousClose: number;
  yearHigh: number;
  yearLow: number;
}

export interface SectorPerformance {
  sector: string;
  change: number;
  changePercent: number;
  advancers: number;
  decliners: number;
}

export interface PreMarketEntry {
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  change: number;
  changePercent: number;
  volume: number;
  previousClose: number;
  yearHigh: number;
  yearLow: number;
  /** IEP – Indicative Equilibrium Price (pre-open specific) */
  iep: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NSE_BASE = "https://www.nseindia.com";

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  Connection: "keep-alive",
};

const COOKIE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const RETRY_COUNT = 2;
const RETRY_DELAY_MS = 1_000;

const SECTOR_INDICES = [
  "NIFTY BANK",
  "NIFTY IT",
  "NIFTY PHARMA",
  "NIFTY AUTO",
  "NIFTY FMCG",
  "NIFTY METAL",
  "NIFTY REALTY",
  "NIFTY ENERGY",
] as const;

// ---------------------------------------------------------------------------
// Cookie cache
// ---------------------------------------------------------------------------

let cachedCookies: string | null = null;
let cookieTimestamp = 0;

/**
 * Fetch the NSE home page to obtain session cookies, then cache them for
 * {@link COOKIE_TTL_MS} milliseconds.
 */
async function getNSECookies(): Promise<string> {
  const now = Date.now();

  if (cachedCookies && now - cookieTimestamp < COOKIE_TTL_MS) {
    return cachedCookies;
  }

  const response = await fetch(NSE_BASE, {
    headers: BROWSER_HEADERS,
    redirect: "follow",
  });

  // `getSetCookie()` returns an array of individual Set-Cookie header values.
  // We extract just the key=value portion of each cookie (before the first `;`)
  // and join them with "; " so they can be sent back as a single Cookie header.
  const setCookieHeaders: string[] =
    (response.headers as any).getSetCookie?.() ??
    (response.headers.get("set-cookie")?.split(/,(?=\s*\w+=)/) ?? []);

  const cookies = setCookieHeaders
    .map((c: string) => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");

  cachedCookies = cookies;
  cookieTimestamp = Date.now();

  return cookies;
}

// ---------------------------------------------------------------------------
// Core fetcher with retry
// ---------------------------------------------------------------------------

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch a JSON endpoint from NSE, automatically attaching session cookies
 * and retrying on failure.
 */
async function fetchNSE<T = unknown>(path: string): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= RETRY_COUNT; attempt++) {
    try {
      const cookies = await getNSECookies();

      const res = await fetch(`${NSE_BASE}${path}`, {
        headers: {
          ...BROWSER_HEADERS,
          Cookie: cookies,
          Referer: NSE_BASE,
        },
        redirect: "follow",
      });

      if (!res.ok) {
        throw new Error(`NSE responded with status ${res.status} for ${path}`);
      }

      return (await res.json()) as T;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Invalidate cookies so the next attempt gets fresh ones
      cachedCookies = null;

      if (attempt < RETRY_COUNT) {
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  throw lastError ?? new Error(`Failed to fetch ${path}`);
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

/** Safely coerce a value to a finite number, defaulting to 0. */
function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Map a raw NSE stock record into the normalised {@link NSEStockData} shape.
 */
function mapStockData(raw: Record<string, unknown>): NSEStockData {
  return {
    symbol: String(raw.symbol ?? ""),
    open: num(raw.open),
    high: num(raw.dayHigh),
    low: num(raw.dayLow),
    close: num(raw.lastPrice),
    change: num(raw.change),
    changePercent: num(raw.pChange),
    volume: num(raw.totalTradedVolume),
    previousClose: num(raw.previousClose),
    yearHigh: num(raw.yearHigh),
    yearLow: num(raw.yearLow),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch NIFTY 50 constituents with current market data.
 */
export async function fetchNifty50Data(): Promise<NSEStockData[]> {
  try {
    const json = await fetchNSE<{ data?: Record<string, unknown>[] }>(
      "/api/equity-stockIndices?index=NIFTY%2050"
    );

    if (!Array.isArray(json?.data)) return [];

    // The first element is usually the index summary row – include individual
    // stocks only (they carry a `symbol` property that is not "NIFTY 50").
    return json.data
      .filter((d) => d.symbol && d.symbol !== "NIFTY 50")
      .map(mapStockData);
  } catch (err) {
    console.error("[nse-scraper] fetchNifty50Data failed:", err);
    return [];
  }
}

/**
 * Fetch the top 10 gainers from the live analysis endpoint.
 */
export async function fetchTopGainers(): Promise<NSEStockData[]> {
  try {
    const json = await fetchNSE<{
      NIFTY?: { data?: Record<string, unknown>[] };
      allSec?: { data?: Record<string, unknown>[] };
    }>("/api/live-analysis-variations?index=gainers");

    const records =
      json?.NIFTY?.data ?? json?.allSec?.data ?? (json as any)?.data;
    if (!Array.isArray(records)) return [];

    return records.slice(0, 10).map(mapStockData);
  } catch (err) {
    console.error("[nse-scraper] fetchTopGainers failed:", err);
    return [];
  }
}

/**
 * Fetch the top 10 losers from the live analysis endpoint.
 */
export async function fetchTopLosers(): Promise<NSEStockData[]> {
  try {
    const json = await fetchNSE<{
      NIFTY?: { data?: Record<string, unknown>[] };
      allSec?: { data?: Record<string, unknown>[] };
    }>("/api/live-analysis-variations?index=losers");

    const records =
      json?.NIFTY?.data ?? json?.allSec?.data ?? (json as any)?.data;
    if (!Array.isArray(records)) return [];

    return records.slice(0, 10).map(mapStockData);
  } catch (err) {
    console.error("[nse-scraper] fetchTopLosers failed:", err);
    return [];
  }
}

/**
 * Fetch NIFTY pre-open (pre-market) session data.
 */
export async function fetchPreMarketData(): Promise<PreMarketEntry[]> {
  try {
    const json = await fetchNSE<{ data?: Record<string, unknown>[] }>(
      "/api/market-data-pre-open?key=NIFTY"
    );

    if (!Array.isArray(json?.data)) return [];

    return json.data.map((item) => {
      // The pre-open endpoint nests most fields inside a `metadata` object.
      const raw: Record<string, unknown> =
        (item.metadata as Record<string, unknown>) ?? item;

      return {
        ...mapStockData(raw),
        iep: num(raw.iep ?? item.iep ?? item.lastPrice),
      };
    });
  } catch (err) {
    console.error("[nse-scraper] fetchPreMarketData failed:", err);
    return [];
  }
}

/**
 * Fetch performance data for major NIFTY sector indices.
 */
export async function fetchSectorPerformance(): Promise<SectorPerformance[]> {
  const results: SectorPerformance[] = [];

  // Fire all requests concurrently for speed.
  const settled = await Promise.allSettled(
    SECTOR_INDICES.map(async (sector) => {
      const encoded = encodeURIComponent(sector);
      const json = await fetchNSE<{
        data?: Record<string, unknown>[];
        metadata?: Record<string, unknown>;
        advance?: Record<string, unknown>;
      }>(`/api/equity-stockIndices?index=${encoded}`);

      if (!Array.isArray(json?.data) || json.data.length === 0) return null;

      // The first element is typically the index-level summary row.
      const indexRow = json.data[0];

      // Advance / decline info may appear at various locations depending on
      // the index.  Try the dedicated `advance` block first, then the
      // metadata, then fall back to counting constituents.
      let advancers = 0;
      let decliners = 0;

      if (json.advance) {
        advancers = num(json.advance.advances);
        decliners = num(json.advance.declines);
      } else if (json.metadata) {
        advancers = num(json.metadata.advances);
        decliners = num(json.metadata.declines);
      } else {
        // Manual count from constituent rows (skip index summary at [0]).
        for (let i = 1; i < json.data.length; i++) {
          const pChange = num(json.data[i].pChange);
          if (pChange > 0) advancers++;
          else if (pChange < 0) decliners++;
        }
      }

      return {
        sector,
        change: num(indexRow.change),
        changePercent: num(indexRow.pChange),
        advancers,
        decliners,
      } satisfies SectorPerformance;
    })
  );

  for (const outcome of settled) {
    if (outcome.status === "fulfilled" && outcome.value) {
      results.push(outcome.value);
    }
  }

  return results;
}
