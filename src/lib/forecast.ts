import type { Candle, Forecast, Indicators } from "./types";

function linreg(ys: number[]) {
  const n = ys.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i += 1) {
    sumX += i;
    sumY += ys[i];
    sumXY += i * ys[i];
    sumXX += i * i;
  }
  const denom = n * sumXX - sumX * sumX || 1e-9;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  let ssRes = 0;
  let ssTot = 0;
  const mean = sumY / n;
  for (let i = 0; i < n; i += 1) {
    const fitted = intercept + slope * i;
    ssRes += (ys[i] - fitted) ** 2;
    ssTot += (ys[i] - mean) ** 2;
  }
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  return { slope, intercept, r2 };
}

function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo);
}

function stepSeconds(candles: Candle[]) {
  if (candles.length < 2) return 86400;
  return Math.max(60, candles[candles.length - 1].time - candles[candles.length - 2].time);
}

export function buildForecast(
  candles: Candle[],
  indicators: Indicators,
  horizon = 10,
): Forecast {
  const window = candles.slice(-Math.min(120, candles.length));
  const closes = window.map((c) => c.close);
  const last = closes.at(-1) ?? 0;
  const logs = closes.map((c) => Math.log(Math.max(c, 1e-9)));
  const trend = linreg(logs);

  const residuals: number[] = [];
  for (let i = 1; i < logs.length; i += 1) {
    residuals.push(logs[i] - logs[i - 1]);
  }
  const meanRet = residuals.reduce((a, b) => a + b, 0) / Math.max(residuals.length, 1);
  const std =
    Math.sqrt(
      residuals.reduce((a, b) => a + (b - meanRet) ** 2, 0) / Math.max(residuals.length - 1, 1),
    ) || 0.01;

  let phi = 0;
  if (residuals.length > 3) {
    let num = 0;
    let den = 0;
    for (let i = 1; i < residuals.length; i += 1) {
      num += residuals[i] * residuals[i - 1];
      den += residuals[i - 1] ** 2;
    }
    phi = Math.max(-0.6, Math.min(0.6, den ? num / den : 0));
  }

  const rsi = indicators.rsi ?? 50;
  const macdHist = indicators.macdHistogram ?? 0;
  const sma50 = indicators.sma50 ?? last;
  const atrPct = (indicators.atrPercent ?? 2) / 100;

  const momentumBias = Math.max(-0.015, Math.min(0.015, (rsi - 50) / 50 / 80 + macdHist / last / 8));
  const reversionBias = Math.max(-0.01, Math.min(0.01, (sma50 - last) / last / 40));
  const drift = trend.slope * 0.55 + meanRet * 0.25 + momentumBias + reversionBias;

  const step = stepSeconds(window);
  const points: Forecast["points"] = [];
  let meanLog = Math.log(last);
  let shock = residuals.at(-1) ?? 0;
  for (let h = 1; h <= horizon; h += 1) {
    shock = phi * shock;
    meanLog += drift + shock * 0.35;
    const mean = Math.exp(meanLog);
    const sigma = std * Math.sqrt(h) * (1 + atrPct * 4);
    const low = Math.exp(meanLog + percentile(residuals, 0.1) * Math.sqrt(h) - sigma * 0.85);
    const high = Math.exp(meanLog + percentile(residuals, 0.9) * Math.sqrt(h) + sigma * 0.85);
    points.push({
      time: window[window.length - 1].time + step * h,
      mean,
      low: Math.min(low, mean),
      high: Math.max(high, mean),
    });
  }

  const expectedPrice = points.at(-1)?.mean ?? last;
  const expectedChangePercent = ((expectedPrice - last) / last) * 100;
  const bandLow = points.at(-1)?.low ?? last * 0.97;
  const bandHigh = points.at(-1)?.high ?? last * 1.03;
  const width = (bandHigh - bandLow) / last;
  const agreement =
    (Math.sign(momentumBias) === Math.sign(trend.slope) ? 0.12 : 0) +
    (Math.sign(macdHist) === Math.sign(expectedChangePercent) ? 0.1 : 0);
  const confidence = Math.max(
    0.28,
    Math.min(0.78, 0.38 + Math.max(0, trend.r2) * 0.28 - width * 0.35 + agreement),
  );

  return {
    horizon,
    method:
      "Ensemble K-line forecast: log-linear trend + AR(1) residuals, RSI/MACD momentum, and SMA mean-reversion. Inspired by Kronos (OHLCV token language + multi-path sampling), without loading transformer weights.",
    expectedChangePercent,
    expectedPrice,
    confidence,
    bandLow,
    bandHigh,
    points,
    disclaimer:
      "Forecasts are probabilistic ranges from historical structure, not guaranteed outcomes. Not investment advice.",
  };
}
