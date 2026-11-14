export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type Quote = {
  symbol: string;
  name: string;
  exchange: string;
  currency: string;
  price: number;
  change: number;
  changePercent: number;
  previousClose: number;
  open: number;
  dayHigh: number;
  dayLow: number;
  volume: number;
  averageVolume: number | null;
  marketCap: number | null;
  pe: number | null;
  eps: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  dividendYield: number | null;
  beta: number | null;
  sector: string | null;
  industry: string | null;
  marketState: string;
};

export type SearchResult = {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
};

export type NewsItem = {
  title: string;
  publisher: string;
  link: string;
  publishedAt: string;
  sentiment: "positive" | "negative" | "neutral";
  score: number;
};

export type Indicators = {
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  ema12: number | null;
  ema26: number | null;
  rsi: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  bbUpper: number | null;
  bbMiddle: number | null;
  bbLower: number | null;
  atr: number | null;
  atrPercent: number | null;
  stochasticK: number | null;
  stochasticD: number | null;
  volumeSma: number | null;
  volumeRatio: number | null;
  realizedVol: number | null;
  /** Wilder ADX (trend strength 0-100) and directional indicators. */
  adx: number | null;
  plusDI: number | null;
  minusDI: number | null;
  series: {
    sma20: Array<{ time: number; value: number }>;
    sma50: Array<{ time: number; value: number }>;
    ema12: Array<{ time: number; value: number }>;
    rsi: Array<{ time: number; value: number }>;
    macd: Array<{ time: number; macd: number; signal: number; hist: number }>;
    bb: Array<{ time: number; upper: number; middle: number; lower: number }>;
  };
};

export type Signal = {
  id: string;
  label: string;
  tone: "bullish" | "bearish" | "neutral" | "warning";
  detail: string;
};

export type Recommendation = "BUY" | "SELL" | "HOLD";

/** Out-of-sample backtest record of the call type (see src/scripts/backtest.ts). */
export type TrackRecord = {
  status: "proven" | "unproven" | "untested";
  hitRate: number | null;
  /** Average return per trade after costs (fraction). */
  expectancy: number | null;
  profitFactor: number | null;
  /** Return vs the average stock over the same days (fraction, before costs). */
  edge: number | null;
  samples: number;
  horizonDays: number;
  period: string | null;
};

export type Insight = {
  recommendation: Recommendation;
  track: TrackRecord;
  score: number;
  confidence: number;
  headline: string;
  summary: string;
  working: string[];
  notWorking: string[];
  risks: string[];
  support: number[];
  resistance: number[];
  reasoning: string[];
  signals: Signal[];
};

export type ForecastPoint = {
  time: number;
  mean: number;
  low: number;
  high: number;
};

export type Forecast = {
  horizon: number;
  method: string;
  expectedChangePercent: number;
  expectedPrice: number;
  confidence: number;
  bandLow: number;
  bandHigh: number;
  points: ForecastPoint[];
  disclaimer: string;
};

export type AnalyzeResponse = {
  quote: Quote;
  candles: Candle[];
  range: string;
  interval: string;
  indicators: Indicators;
  insight: Insight;
  forecast: Forecast;
  news: NewsItem[];
  newsSentiment: {
    label: "positive" | "negative" | "neutral";
    score: number;
  };
  provider: string;
  /** Daily-rule markers (swing engine replayed walk-forward, golden/death cross), placed on this chart's candles. */
  dailySignals?: import("./chart-studies").ChartSignal[];
  /** Chart candles plus earlier warm-up candles at the same interval (indicators are computed on these). */
  studyCandles?: Candle[];
};

export type MarketIndex = {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
};

export type AlertRule = {
  id: string;
  symbol: string;
  type: "price_above" | "price_below" | "pct_change" | "volume_spike" | "volatility_spike" | "news";
  value: number;
  enabled: boolean;
  createdAt: string;
  lastTriggeredAt: string | null;
};

export type AlertEvent = {
  id: string;
  ruleId: string;
  symbol: string;
  message: string;
  at: string;
  severity: "info" | "warning" | "critical";
};

/** A price snapshot from the live layer (NSE when fresher, otherwise Yahoo). */
export type LiveQuote = {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  previousClose: number | null;
  open: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  volume: number | null;
  /** Unix seconds of the last trade/update. */
  time: number;
  /** REGULAR, PRE, POST, CLOSED … */
  marketState: string;
  delayMinutes: number;
  /** Human-readable data source, e.g. "NSE (1-min)" or "Yahoo (15-min delayed)". */
  source: string;
};
