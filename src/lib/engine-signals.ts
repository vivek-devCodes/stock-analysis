// Replays the swing engine bar by bar (walk-forward: each bar sees only data up to that day) and
// returns the days its call changed to BUY or SELL — the markers drawn on the candlestick chart.

import { buildInsight } from "./analysis";
import type { ChartSignal } from "./chart-studies";
import { computeIndicators } from "./indicators";
import type { Candle, Quote } from "./types";

function quoteAt(symbol: string, c: Candle[], i: number): Quote {
  const p = c[i - 1]?.close ?? c[i].close;
  return {
    symbol, name: symbol, exchange: "", currency: "", price: c[i].close, change: c[i].close - p, changePercent: ((c[i].close - p) / p) * 100,
    previousClose: p, open: c[i].open, dayHigh: c[i].high, dayLow: c[i].low, volume: c[i].volume, averageVolume: null, marketCap: null,
    pe: null, eps: null, fiftyTwoWeekHigh: null, fiftyTwoWeekLow: null, dividendYield: null, beta: null, sector: null, industry: null, marketState: "CLOSED",
  };
}

/** A repeat signal in the same direction within this many bars is not drawn again (declutters the chart). */
const MIN_GAP_BARS = 15;

/** Engine BUY/SELL transitions within [fromTime, last bar]. Needs ~210 daily bars of warm-up. */
export function engineSignals(symbol: string, daily: Candle[], fromTime: number): ChartSignal[] {
  const out: ChartSignal[] = [];
  let prev: string | null = null;
  let lastSide: string | null = null;
  let lastIdx = -Infinity;
  for (let i = 210; i < daily.length; i += 1) {
    const slice = daily.slice(Math.max(0, i - 299), i + 1);
    const rec = buildInsight(quoteAt(symbol, daily, i), slice, computeIndicators(slice), []).recommendation;
    const fresh = rec !== lastSide || i - lastIdx >= MIN_GAP_BARS;
    if (rec !== prev && rec !== "HOLD" && fresh) {
      lastSide = rec;
      lastIdx = i;
    }
    if (daily[i].time >= fromTime && rec !== prev && rec !== "HOLD" && lastIdx === i) {
      out.push({
        time: daily[i].time,
        side: rec === "BUY" ? "buy" : "sell",
        source: "engine",
        label: rec === "BUY" ? "BUY" : "SELL",
        detail: rec === "BUY" ? "Swing engine: uptrend + pullback (buy-the-dip setup)" : "Swing engine: downtrend + bounce (sell-the-rally setup)",
      });
    }
    prev = rec;
  }
  return out;
}
