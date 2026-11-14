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
  | "range";

export const STUDIES: Array<{ id: StudyId; label: string; group: "Trend" | "Volatility" | "Levels"; hint: string; intradayOnly?: boolean }> = [
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
];

export type SignalId = "engine" | "supertrend" | "golden-cross";

type Side = { n: number; hitRate: number; expectancy: number; profitFactor: number; edge: number; proven: boolean } | null;
type Track = { horizonDays: number; period: string; buy: Side; sell: Side };

const S = signalStats as unknown as Record<string, Track | undefined>;
const CAL = calibration as unknown as { horizonDays: number; period: string; buy: Side; sell: Side };

export const SIGNALS: Array<{ id: SignalId; label: string; hint: string; dailyOnly?: boolean; track: Track | null }> = [
  {
    id: "engine",
    label: "Swing engine",
    hint: "BUY = uptrend + pullback, SELL = downtrend + bounce, replayed day by day (daily charts).",
    dailyOnly: true,
    track: CAL.buy || CAL.sell ? { horizonDays: CAL.horizonDays, period: CAL.period, buy: CAL.buy, sell: CAL.sell } : null,
  },
  { id: "supertrend", label: "Supertrend flips", hint: "BUY when Supertrend(10, 3) turns up, SELL when it turns down.", track: S["supertrend"] ?? null },
  { id: "golden-cross", label: "Golden / Death cross", hint: "50-day average crossing the 200-day (needs ≥ 1 year of daily data).", dailyOnly: true, track: S["golden-cross"] ?? null },
];

export const DEFAULT_STUDIES: StudyId[] = ["sma", "bollinger"];
export const DEFAULT_SIGNALS: SignalId[] = ["engine"];
