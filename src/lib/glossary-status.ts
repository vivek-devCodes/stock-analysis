import type { GlossaryTerm } from "./glossary-data/build";

// Which glossary terms Apex Desk actually calculates or uses, and where.
// Shown as the "In Apex Desk" badge on the Glossary page. Keep this honest: only list
// things the code really does (see src/lib/indicators.ts, screener.ts, fundamentals.ts, …).

type Entry = { where: string; /** limit to these chapters when the abbreviation is ambiguous */ chapters?: string[] };

const IMPLEMENTED: Record<string, Entry> = {
  // Technical indicators (src/lib/indicators.ts, formula-tested by npm run test:indicators)
  RSI: { where: "Analyzer chart + all desks — Wilder RSI(14)" },
  MACD: { where: "Analyzer chart — MACD(12, 26, 9)" },
  "MACD Signal Line": { where: "Analyzer chart — 9-period EMA of MACD" },
  EMA: { where: "Analyzer chart (EMA 12) and MACD" },
  SMA: { where: "20/50/200-day averages — trend filter for swing setups" },
  MA: { where: "20/50/200-day averages — trend filter for swing setups" },
  "Golden Cross": { where: "Long-term desk and swing trend filter (50-DMA vs 200-DMA)" },
  "Death Cross": { where: "Long-term desk and swing trend filter (50-DMA vs 200-DMA)" },
  "MA Slope": { where: "Long-term desk (200-DMA slope over 20 days)" },
  "Bollinger Bands": { where: "Analyzer chart — 20, 2σ; also used for pullback/extended checks" },
  BB: { where: "Analyzer chart — 20, 2σ" },
  ATR: { where: "Analyzer, stops/targets on all desks — Wilder ATR(14)" },
  ADX: { where: "Analyzer + swing setups — Wilder ADX(14) trend strength" },
  DMI: { where: "Analyzer + swing setups — +DI / −DI" },
  "+DI": { where: "Analyzer + swing setups" },
  "-DI": { where: "Analyzer + swing setups" },
  "Stochastic Oscillator": { where: "Analyzer — %K(14, 3) / %D(3)" },
  VWAP: { where: "Intraday desk — session VWAP from 15-min candles" },
  "Relative Volume": { where: "Analyzer + Intraday desk (vs the same time of day)" },
  RVOL: { where: "Analyzer + Intraday desk" },
  "Historical Volatility": { where: "Analyzer, Long-term desk, Options 1-week move — annualised by bar size" },
  "Standard Deviation": { where: "Bollinger Bands and the expected-range band" },
  // Price action & intraday
  Support: { where: "Analyzer — clustered swing-low pivots" },
  Resistance: { where: "Analyzer — clustered swing-high pivots" },
  "Swing High": { where: "Support/resistance detection" },
  "Swing Low": { where: "Support/resistance detection" },
  "Opening Range": { where: "Intraday desk — first 30 minutes" },
  ORB: { where: "Intraday desk — 30-minute opening-range breakout" },
  "Previous Day High (PDH)": { where: "Intraday desk" },
  "Previous Day Low (PDL)": { where: "Intraday desk" },
  "Previous Day Close (PDC)": { where: "Intraday desk (gap and CPR)" },
  PDH: { where: "Intraday desk" },
  PDL: { where: "Intraday desk" },
  PDC: { where: "Intraday desk" },
  CPR: { where: "Intraday desk — P, BC, TC from the previous session" },
  "Gap Up": { where: "Intraday desk" },
  "Gap Down": { where: "Intraday desk" },
  Pullback: { where: "Swing engine — buy-the-dip setup in an uptrend" },
  // Fundamentals (src/lib/fundamentals.ts)
  ROE: { where: "Stock Screener (TTM, from Yahoo)" },
  ROA: { where: "Stock Screener data" },
  "D/E": { where: "Stock Screener (ignored for banks/NBFCs)" },
  PE: { where: "Stock Screener and Analyzer (trailing)", chapters: ["4", "24"] },
  PB: { where: "Stock Screener", chapters: ["4", "24"] },
  EPS: { where: "Analyzer (trailing EPS)" },
  "Market Capitalization": { where: "Stock Screener (₹ crore) and Analyzer" },
  "Dividend Yield": { where: "Stock Screener" },
  "Current Ratio": { where: "Stock Screener quality score (non-financials)" },
  CR: { where: "Stock Screener quality score (non-financials)", chapters: ["4", "24"] },
  NPM: { where: "Stock Screener (net margin)" },
  "Net Margin": { where: "Stock Screener" },
  "Revenue Growth": { where: "Stock Screener (latest quarter YoY)" },
  "EPS Growth": { where: "Stock Screener (latest quarter YoY)" },
  "Promoter Holding %": { where: "Stock Screener (insider holding as reported by Yahoo)" },
  Beta: { where: "Analyzer" },
  "Negative Operating Cash Flow": { where: "Stock Screener red-flag (non-financials)" },
  "Negative Net Worth": { where: "Stock Screener red-flag" },
  "High Debt-to-Equity": { where: "Stock Screener red-flag (D/E > 1, non-financials)" },
  "Unusual Volume Spikes": { where: "Analyzer risk note (volume ≥ 2× its 20-day average)" },
  // Market data & infrastructure
  LTP: { where: "Live quotes (NSE ~1 min when available, otherwise Yahoo)" },
  OHLC: { where: "All charts and scans" },
  OHLCV: { where: "All charts and scans" },
  "Live Data": { where: "Ticker strip and Analyzer — NSE live feed during market hours" },
  "Delayed Data": { where: "Yahoo fallback — 15-minute delay for NSE/BSE, labelled on every price" },
  MCP: { where: "NSE's official live-market server, called directly over HTTP" },
  Cache: { where: "Quotes 5 s, scans 1.5–60 min, news 10 min, fundamentals 6 h" },
  "Rate Limit": { where: "Login throttle and the news crawler's per-site pacing" },
  "Retry Mechanism": { where: "News crawler (honours Retry-After) and data fetches" },
  Timeout: { where: "All external requests" },
  // Research & risk (src/scripts/backtest.ts)
  Backtesting: { where: "npm run backtest — 5-year walk-forward test of the swing engine" },
  "Out-of-Sample Testing": { where: "Backtest — rules judged only on the newest 40% of data" },
  "In-Sample Testing": { where: "Backtest — design period (older 60%)" },
  "Walk-forward Analysis": { where: "Backtest — signals use only data available on each day" },
  "Look-ahead Bias": { where: "Backtest avoids it — no future data in any signal" },
  "Survivorship Bias": { where: "Disclosed as a backtest caveat (today's large caps only)" },
  "Hit Rate": { where: "Track record on every swing/options call" },
  "Win Rate": { where: "Track record on every swing/options call" },
  "Profit Factor": { where: "Track record on every swing/options call" },
  Expectancy: { where: "Track record on every swing/options call (after costs)" },
  "Payoff Ratio": { where: "Backtest report" },
  "Transaction Cost": { where: "Backtest — 0.3% round trip deducted" },
  STT: { where: "Included in the backtest's 0.3% round-trip cost" },
  "Stop Loss": { where: "ATR-based stop on every desk card" },
  "Target Price": { where: "ATR / resistance-based target on desk cards" },
  "Risk/Reward": { where: "Reward : risk shown on desk cards" },
  MAE: { where: "Used to test the old forecast (it lost to 'no change')" },
  RMSE: { where: "Used to test the old forecast" },
  "Sentiment Analysis": { where: "Keyword sentiment on news headlines" },
  "Sentiment Score": { where: "Keyword sentiment on news headlines" },
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+\-]/g, "");
const INDEX = new Map(Object.entries(IMPLEMENTED).map(([k, v]) => [norm(k), v]));

/** Where Apex Desk implements this term, or undefined. `sectionNumber` is like "6.2". */
export function implementationOf(t: GlossaryTerm, sectionNumber: string): string | undefined {
  const chapter = sectionNumber.split(".")[0];
  for (const key of [t.term, t.full]) {
    if (!key) continue;
    const hit = INDEX.get(norm(key));
    if (hit && (!hit.chapters || hit.chapters.includes(chapter))) return hit.where;
  }
  return undefined;
}
