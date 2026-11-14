import type { Candle, Forecast, Indicators } from "./types";

/** z-score for the 90th percentile of a normal distribution (two-sided 80% interval). */
const Z80 = 1.2816;

/** Real returns have fatter tails than a normal distribution, so widen the band slightly. */
const TAIL_WIDENING = 1.08;

function stepSeconds(candles: Candle[]) {
  if (candles.length < 2) return 86400;
  return Math.max(60, candles[candles.length - 1].time - candles[candles.length - 2].time);
}

/**
 * Expected price RANGE, not a direction call.
 *
 * Measured on 5 years of NSE daily data, the previous trend-extrapolating forecast was less accurate
 * than simply assuming no change (MAE 4.60% vs 4.01% over 10 days) and called direction only 50.6%
 * of the time. So the centre is today's price (random walk, no drift) and the band is an 80% interval:
 *   price × exp(± z(0.9) · σ · √h · k)
 * where σ = max(daily log-return std-dev, ATR% / 1.6) and k = TAIL_WIDENING.
 */
export function buildForecast(candles: Candle[], indicators: Indicators, horizon = 10): Forecast {
  const window = candles.slice(-Math.min(120, candles.length));
  const closes = window.map((c) => c.close);
  const last = closes.at(-1) ?? 0;

  const rets: number[] = [];
  for (let i = 1; i < closes.length; i += 1) {
    if (closes[i - 1] > 0 && closes[i] > 0) rets.push(Math.log(closes[i] / closes[i - 1]));
  }
  const mean = rets.reduce((a, b) => a + b, 0) / Math.max(rets.length, 1);
  const std = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(rets.length - 1, 1)) || 0.01;
  const atrPct = (indicators.atrPercent ?? 2) / 100;
  const sigmaPerBar = Math.max(std, atrPct / 1.6) * TAIL_WIDENING;

  const step = stepSeconds(window);
  const points: Forecast["points"] = [];
  for (let h = 1; h <= horizon; h += 1) {
    const sigma = sigmaPerBar * Math.sqrt(h);
    points.push({
      time: (window.at(-1)?.time ?? 0) + step * h,
      mean: last,
      low: last * Math.exp(-Z80 * sigma),
      high: last * Math.exp(Z80 * sigma),
    });
  }

  return {
    horizon,
    method: "Volatility range: an 80% interval around today's price from recent volatility (ATR and return std-dev). It does not predict direction.",
    expectedChangePercent: 0,
    expectedPrice: last,
    confidence: 0.8,
    bandLow: points.at(-1)?.low ?? last * 0.95,
    bandHigh: points.at(-1)?.high ?? last * 1.05,
    points,
    disclaimer: "About 8 in 10 outcomes should land inside this range and 2 in 10 outside it. Not a price target and not investment advice.",
  };
}
