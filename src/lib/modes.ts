// Dashboard modes. Shared by the hub, the mode dashboards and /api/screener,
// so keep this file free of server-only imports.

export const MODES = ["intraday", "short-term", "long-term", "options"] as const;
export type Mode = (typeof MODES)[number];

export type ModeInfo = {
  key: Mode;
  label: string;
  title: string;
  horizon: string;
  timeframe: string;
  description: string;
  bullTitle: string;
  bearTitle: string;
  /** Auto-refresh interval for the dashboard, in ms (0 = manual only). */
  refreshMs: number;
};

export const MODE_INFO: Record<Mode, ModeInfo> = {
  intraday: {
    key: "intraday",
    label: "Intraday",
    title: "Intraday Dashboard",
    horizon: "Same day — square off before 3:30 PM",
    timeframe: "15-minute candles, today's session",
    description: "VWAP, opening-range breakouts, relative volume and 15-min momentum.",
    bullTitle: "Long setups",
    bearTitle: "Short setups",
    refreshMs: 2 * 60 * 1000,
  },
  "short-term": {
    key: "short-term",
    label: "Short Term",
    title: "Short-Term Dashboard",
    horizon: "Swing trades — 1 to 2 weeks",
    timeframe: "Daily candles, last 1 year",
    description: "Trend alignment, RSI, MACD, volume and a 10-day statistical forecast.",
    bullTitle: "Buy candidates",
    bearTitle: "Sell / avoid",
    refreshMs: 0,
  },
  "long-term": {
    key: "long-term",
    label: "Long Term",
    title: "Long-Term Dashboard",
    horizon: "Positional — 3 to 12 months",
    timeframe: "Daily candles, last 2 years",
    description: "200-day trend, golden cross, 6-month and 1-year momentum, distance from 52-week high.",
    bullTitle: "Accumulate",
    bearTitle: "Avoid",
    refreshMs: 0,
  },
  options: {
    key: "options",
    label: "Options — Call / Put",
    title: "Options Dashboard (Call / Put)",
    horizon: "Directional option buying — days to expiry",
    timeframe: "Daily trend + near-the-money strike",
    description: "CALL or PUT bias on Nifty, Bank Nifty and F&O stocks, with an approximate ATM strike.",
    bullTitle: "CALL bias",
    bearTitle: "PUT bias",
    refreshMs: 5 * 60 * 1000,
  },
};

export function isMode(value: string | null | undefined): value is Mode {
  return !!value && (MODES as readonly string[]).includes(value);
}

export type PickAction = "BUY" | "SELL" | "ACCUMULATE" | "AVOID" | "CALL" | "PUT" | "WAIT";

export type ScreenPick = {
  symbol: string;
  name: string;
  sector: string;
  price: number;
  changePercent: number;
  bias: "bullish" | "bearish" | "neutral";
  action: PickAction;
  /** -100 (strongly bearish) … +100 (strongly bullish) */
  score: number;
  entry: number;
  target: number | null;
  stop: number | null;
  /** Labels for the target/stop fields, since they mean different things per mode. */
  targetLabel: string;
  stopLabel: string;
  metrics: Array<{ label: string; value: string; tone?: "up" | "down" | "warn" }>;
  reasons: string[];
  /** Options mode only. */
  option?: { type: "CE" | "PE"; strike: number; strikeStep: number; expiry: string };
};

export type ScreenResult = {
  mode: Mode;
  asOf: string;
  dataAsOf: string | null;
  scanned: number;
  failed: number;
  picks: ScreenPick[];
  notes: string[];
};
