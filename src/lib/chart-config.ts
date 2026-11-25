// Which studies and signals the chart offers, their colours, and the measured track record shown
// next to each BUY/SELL marker type. Client-safe.

import calibration from "./calibration.json";
import signalStats from "./signal-stats.json";

export type StudyId =
  | "sma"
  | "ema-ribbon"
  | "bollinger"
  | "keltner"
  | "donchian"
  | "supertrend"
  | "psar"
  | "ichimoku"
  | "vwap"
  | "levels"
  | "range"
  | "zones"
  | "trendlines"
  | "fib"
  | "pivots"
  | "vwap-bands"
  | "vprofile"
  | "fvg";

export const STUDY_GROUPS = ["Trend", "Volatility", "Levels", "Pro tools"] as const;

export const STUDIES: Array<{ id: StudyId; label: string; group: (typeof STUDY_GROUPS)[number]; hint: string; intradayOnly?: boolean }> = [
  { id: "sma", label: "SMA 20/50/200", group: "Trend", hint: "Simple moving averages (the 200-day is the long-term trend filter)." },
  { id: "ema-ribbon", label: "EMA 9/20/50/200", group: "Trend", hint: "Exponential moving averages — faster to react than SMAs." },
  { id: "supertrend", label: "Supertrend", group: "Trend", hint: "Supertrend(10, 3): green below price in an uptrend, red above it in a downtrend." },
  { id: "psar", label: "Parabolic SAR", group: "Trend", hint: "Stop-and-reverse dots that trail the trend (0.02 / 0.2)." },
  { id: "ichimoku", label: "Ichimoku", group: "Trend", hint: "Conversion (9), base (26), leading spans A/B projected 26 bars ahead, lagging span." },
  { id: "bollinger", label: "Bollinger Bands", group: "Volatility", hint: "SMA 20 ± 2 standard deviations." },
  { id: "keltner", label: "Keltner Channels", group: "Volatility", hint: "EMA 20 ± 2 × ATR(10)." },
  { id: "donchian", label: "Donchian Channels", group: "Volatility", hint: "Highest high / lowest low of the last 20 bars — breakout levels." },
  { id: "vwap", label: "VWAP", group: "Levels", hint: "Volume-weighted average price, reset each session (intraday charts).", intradayOnly: true },
  { id: "levels", label: "Support / Resistance", group: "Levels", hint: "Nearest clustered swing highs and lows." },
  { id: "range", label: "Expected range", group: "Levels", hint: "80% volatility range for the next bars — not a direction call." },
  { id: "zones", label: "Auto S/R zones", group: "Pro tools", hint: "Support and resistance zones from clustered swing highs/lows, with touch counts — the same zones the agents use for stops and targets." },
  { id: "trendlines", label: "Auto trendlines", group: "Pro tools", hint: "The best rising support line and falling resistance line through swing points, extended to today." },
  { id: "fib", label: "Auto Fibonacci", group: "Pro tools", hint: "Retracement (23.6–78.6%) and extensions (127.2%, 161.8%) of the latest major swing." },
  { id: "pivots", label: "Pivots + PDH/PDL", group: "Pro tools", hint: "Floor-trader pivot (P, R1–R2, S1–S2) and the previous session's high, low and close." },
  { id: "vwap-bands", label: "VWAP ± σ bands", group: "Pro tools", hint: "Session VWAP with 1 and 2 standard-deviation bands (intraday charts).", intradayOnly: true },
  { id: "vprofile", label: "Volume profile", group: "Pro tools", hint: "Point of control (most traded price) and the 70% value area of the visible candles." },
  { id: "fvg", label: "Fair-value gaps", group: "Pro tools", hint: "Unfilled three-candle imbalances — price often returns to fill them." },
];

export type SignalId = "engine" | "supertrend" | "golden-cross" | "structure" | "pattern";

type Side = { n: number; hitRate: number; expectancy: number; profitFactor: number; edge: number; proven: boolean } | null;
type Track = { horizonDays: number; period: string; buy: Side; sell: Side };

const S = signalStats as unknown as Record<string, Track | undefined>;
const CAL = calibration as unknown as { horizonDays: number; period: string; buy: Side; sell: Side };

export const SIGNALS: Array<{ id: SignalId; label: string; hint: string; track: Track | null }> = [
  {
    id: "engine",
    label: "Swing engine",
    hint: "BUY = uptrend + pullback, SELL = downtrend + bounce. A daily rule, replayed day by day; on 1D/5D/1M it sits on the first candle of that day.",
    track: CAL.buy || CAL.sell ? { horizonDays: CAL.horizonDays, period: CAL.period, buy: CAL.buy, sell: CAL.sell } : null,
  },
  { id: "supertrend", label: "Supertrend flips", hint: "BUY when Supertrend(10, 3) turns up, SELL when it turns down.", track: S["supertrend"] ?? null },
  { id: "golden-cross", label: "Golden / Death cross", hint: "50-day average crossing the 200-day. A daily rule; on intraday charts it sits on the first candle of that day.", track: S["golden-cross"] ?? null },
  { id: "structure", label: "Market structure (BOS / CHoCH)", hint: "Break of structure (with the trend) and change of character (trend flips) when a close breaks the last swing high or low.", track: null },
  { id: "pattern", label: "Candlestick patterns", hint: "Engulfing, hammer, shooting star, morning / evening star on the candles.", track: null },
];

/** Marker colours per source and side (also shown as swatches in the legend). */
export const SIGNAL_COLORS: Record<SignalId, { buy: string; sell: string }> = {
  engine: { buy: "#3dd68c", sell: "#ff5c7a" },
  supertrend: { buy: "#22d3ee", sell: "#fb923c" },
  "golden-cross": { buy: "#facc15", sell: "#e879f9" },
  structure: { buy: "#60a5fa", sell: "#f97316" },
  pattern: { buy: "#a3e635", sell: "#fda4af" },
};

export const DEFAULT_STUDIES: StudyId[] = ["sma"];
export const DEFAULT_SIGNALS: SignalId[] = ["engine", "supertrend"];
