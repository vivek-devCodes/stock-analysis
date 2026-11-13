const KEY = "apex-watchlist";
const DEFAULT = [
  "RELIANCE.NS",
  "TCS.NS",
  "INFY.NS",
  "HDFCBANK.NS",
  "SBIN.NS",
  "AAPL",
  "MSFT",
  "NVDA",
  "TSLA",
  "BTC-USD",
];

export function loadWatchlist() {
  if (typeof window === "undefined") return [...DEFAULT];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT;
    const parsed = JSON.parse(raw) as string[];
    return parsed.length ? parsed : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export function saveWatchlist(symbols: string[]) {
  localStorage.setItem(KEY, JSON.stringify(symbols));
}

const ALERT_KEY = "apex-alerts";
const EVENT_KEY = "apex-alert-events";

export function loadJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function saveJson(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

export { ALERT_KEY, EVENT_KEY };
