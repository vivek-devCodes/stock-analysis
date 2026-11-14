import type { Candle, Indicators } from "./types";

function sma(values: number[], period: number) {
  const out: Array<number | null> = Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/**
 * EMA seeded with the SMA of the first `period` real values. Leading nulls (e.g. MACD before
 * EMA26 exists) are skipped instead of being treated as zeros, which would bias the line.
 */
function ema(values: Array<number | null>, period: number) {
  const out: Array<number | null> = Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let prev: number | null = null;
  const seed: number[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (v == null) continue;
    if (prev == null) {
      seed.push(v);
      if (seed.length === period) {
        prev = seed.reduce((a, b) => a + b, 0) / period;
        out[i] = prev;
      }
    } else {
      prev = v * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

/** SMA that ignores leading nulls (used to smooth Stochastic %K and %D). */
function smaNullable(values: Array<number | null>, period: number) {
  const out: Array<number | null> = Array(values.length).fill(null);
  const win: number[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (v == null) continue;
    win.push(v);
    if (win.length > period) win.shift();
    if (win.length === period) out[i] = win.reduce((a, b) => a + b, 0) / period;
  }
  return out;
}

function rsiFrom(gain: number, loss: number) {
  if (gain === 0 && loss === 0) return 50; // flat price: no momentum either way
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

/** Wilder's RSI: first average = simple mean of `period` moves, then Wilder smoothing. */
function rsi(values: number[], period = 14) {
  const out: Array<number | null> = Array(values.length).fill(null);
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < values.length; i += 1) {
    const diff = values[i] - values[i - 1];
    const up = Math.max(diff, 0);
    const down = Math.max(-diff, 0);
    if (i <= period) {
      gain += up;
      loss += down;
      if (i === period) {
        gain /= period;
        loss /= period;
        out[i] = rsiFrom(gain, loss);
      }
    } else {
      gain = (gain * (period - 1) + up) / period;
      loss = (loss * (period - 1) + down) / period;
      out[i] = rsiFrom(gain, loss);
    }
  }
  return out;
}

/** Population standard deviation (what Bollinger Bands use). */
function stdev(values: number[], period: number) {
  const out: Array<number | null> = Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i += 1) {
    const slice = values.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
    out[i] = Math.sqrt(variance);
  }
  return out;
}

function trueRange(candles: Candle[]) {
  return candles.map((c, i) =>
    i === 0
      ? c.high - c.low
      : Math.max(c.high - c.low, Math.abs(c.high - candles[i - 1].close), Math.abs(c.low - candles[i - 1].close)),
  );
}

/** Wilder's ATR: first value = mean of the first `period` true ranges, then (prev x (n-1) + TR) / n. */
function atr(candles: Candle[], period = 14) {
  const out: Array<number | null> = Array(candles.length).fill(null);
  const trs = trueRange(candles);
  let prev: number | null = null;
  for (let i = period - 1; i < trs.length; i += 1) {
    if (prev == null) prev = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    else prev = (prev * (period - 1) + trs[i]) / period;
    out[i] = prev;
  }
  return out;
}

/**
 * Wilder's Directional Movement: +DI, -DI and ADX (trend strength, 0-100).
 * ADX < 20 means no real trend (trend signals unreliable); > 25 means trending.
 */
function adx(candles: Candle[], period = 14) {
  const n = candles.length;
  const plusDI: Array<number | null> = Array(n).fill(null);
  const minusDI: Array<number | null> = Array(n).fill(null);
  const adxOut: Array<number | null> = Array(n).fill(null);
  if (n <= period * 2) return { plusDI, minusDI, adx: adxOut };
  const trs = trueRange(candles);
  let sTR = 0;
  let sPlus = 0;
  let sMinus = 0;
  const dx: number[] = [];
  let adxPrev: number | null = null;
  for (let i = 1; i < n; i += 1) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    const pDM = upMove > downMove && upMove > 0 ? upMove : 0;
    const mDM = downMove > upMove && downMove > 0 ? downMove : 0;
    if (i <= period) {
      sTR += trs[i];
      sPlus += pDM;
      sMinus += mDM;
      if (i < period) continue;
    } else {
      sTR = sTR - sTR / period + trs[i];
      sPlus = sPlus - sPlus / period + pDM;
      sMinus = sMinus - sMinus / period + mDM;
    }
    const pdi = sTR ? (100 * sPlus) / sTR : 0;
    const mdi = sTR ? (100 * sMinus) / sTR : 0;
    plusDI[i] = pdi;
    minusDI[i] = mdi;
    const d = pdi + mdi ? (100 * Math.abs(pdi - mdi)) / (pdi + mdi) : 0;
    if (adxPrev == null) {
      dx.push(d);
      if (dx.length === period) {
        adxPrev = dx.reduce((a, b) => a + b, 0) / period;
        adxOut[i] = adxPrev;
      }
    } else {
      adxPrev = (adxPrev * (period - 1) + d) / period;
      adxOut[i] = adxPrev;
    }
  }
  return { plusDI, minusDI, adx: adxOut };
}

/** Fast %K over `period`, smoothed by `smooth` (slow %K); %D = SMA of slow %K. */
function stochastic(candles: Candle[], period = 14, smooth = 3) {
  const kRaw: Array<number | null> = Array(candles.length).fill(null);
  for (let i = period - 1; i < candles.length; i += 1) {
    const window = candles.slice(i - period + 1, i + 1);
    const highest = Math.max(...window.map((c) => c.high));
    const lowest = Math.min(...window.map((c) => c.low));
    kRaw[i] = highest === lowest ? 50 : ((candles[i].close - lowest) / (highest - lowest)) * 100;
  }
  const k = smaNullable(kRaw, smooth);
  const d = smaNullable(k, smooth);
  return { k, d };
}

/**
 * Bars per year, inferred from candle spacing, so volatility is annualised correctly.
 * Daily = 252, weekly = 52, intraday = 252 x bars per NSE session (6 h 15 m).
 */
export function barsPerYear(candles: Candle[]) {
  const gaps: number[] = [];
  for (let i = Math.max(1, candles.length - 60); i < candles.length; i += 1) gaps.push(candles[i].time - candles[i - 1].time);
  if (!gaps.length) return 252;
  const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
  if (median >= 5 * 86400) return 52;
  if (median >= 20 * 3600) return 252;
  return 252 * Math.max(1, Math.round(22500 / median));
}

function last<T>(arr: Array<T | null | undefined>): T | null {
  for (let i = arr.length - 1; i >= 0; i -= 1) {
    const value = arr[i];
    if (value != null) return value;
  }
  return null;
}

function zipLine(times: number[], values: Array<number | null>) {
  const points: Array<{ time: number; value: number }> = [];
  for (let i = 0; i < times.length; i += 1) {
    const value = values[i];
    if (value != null && Number.isFinite(value)) points.push({ time: times[i], value });
  }
  return points;
}

export function computeIndicators(candles: Candle[]): Indicators {
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const times = candles.map((c) => c.time);

  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const rsi14 = rsi(closes, 14);
  const atr14 = atr(candles, 14);
  const sd20 = stdev(closes, 20);
  const volSma = sma(volumes, 20);
  const stoch = stochastic(candles);
  const dmi = adx(candles, 14);

  const macdLine: Array<number | null> = closes.map((_, i) =>
    ema12[i] != null && ema26[i] != null ? (ema12[i] as number) - (ema26[i] as number) : null,
  );
  const macdSignal = ema(macdLine, 9);
  const macdHist: Array<number | null> = macdLine.map((v, i) =>
    v != null && macdSignal[i] != null ? v - (macdSignal[i] as number) : null,
  );

  const bb = closes.map((_, i) => {
    if (sma20[i] == null || sd20[i] == null) return null;
    const middle = sma20[i] as number;
    const sd = sd20[i] as number;
    return { time: times[i], upper: middle + 2 * sd, middle, lower: middle - 2 * sd };
  });

  const returns: number[] = [];
  for (let i = 1; i < closes.length; i += 1) {
    if (closes[i - 1] > 0) returns.push(Math.log(closes[i] / closes[i - 1]));
  }
  const volWindow = returns.slice(-21);
  const mean = volWindow.reduce((a, b) => a + b, 0) / Math.max(volWindow.length, 1);
  const variance =
    volWindow.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(volWindow.length - 1, 1);
  const realizedVol = Math.sqrt(variance) * Math.sqrt(barsPerYear(candles)) * 100;

  const lastAtr = last(atr14);
  const lastClose = last(closes);

  return {
    sma20: last(sma20),
    sma50: last(sma50),
    sma200: last(sma200),
    ema12: last(ema12),
    ema26: last(ema26),
    rsi: last(rsi14),
    macd: last(macdLine),
    macdSignal: last(macdSignal),
    macdHistogram: last(macdHist),
    bbUpper: last(bb.map((b) => b?.upper ?? null)),
    bbMiddle: last(sma20),
    bbLower: last(bb.map((b) => b?.lower ?? null)),
    atr: lastAtr,
    atrPercent: lastAtr && lastClose ? (lastAtr / lastClose) * 100 : null,
    stochasticK: last(stoch.k),
    stochasticD: last(stoch.d),
    volumeSma: last(volSma),
    // Relative volume: current bar vs the average of the 20 bars BEFORE it.
    volumeRatio: (() => {
      const prior = volumes.slice(-21, -1).filter((v) => v > 0);
      const cur = volumes.at(-1) ?? 0;
      return prior.length >= 10 && cur > 0 ? cur / (prior.reduce((a, b) => a + b, 0) / prior.length) : null;
    })(),
    adx: last(dmi.adx),
    plusDI: last(dmi.plusDI),
    minusDI: last(dmi.minusDI),
    realizedVol: Number.isFinite(realizedVol) ? realizedVol : null,
    series: {
      sma20: zipLine(times, sma20),
      sma50: zipLine(times, sma50),
      ema12: zipLine(times, ema12),
      rsi: zipLine(times, rsi14),
      macd: times
        .map((time, i) =>
          macdLine[i] != null && macdSignal[i] != null && macdHist[i] != null
            ? {
                time,
                macd: macdLine[i] as number,
                signal: macdSignal[i] as number,
                hist: macdHist[i] as number,
              }
            : null,
        )
        .filter((v): v is NonNullable<typeof v> => v != null),
      bb: bb.filter((v): v is NonNullable<typeof v> => v != null),
    },
  };
}

export function pivotLevels(candles: Candle[], lookback = 80) {
  const window = candles.slice(-lookback);
  const closes = window.map((c) => c.close);
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = 2; i < window.length - 2; i += 1) {
    if (
      window[i].high > window[i - 1].high &&
      window[i].high > window[i - 2].high &&
      window[i].high > window[i + 1].high &&
      window[i].high > window[i + 2].high
    ) {
      highs.push(window[i].high);
    }
    if (
      window[i].low < window[i - 1].low &&
      window[i].low < window[i - 2].low &&
      window[i].low < window[i + 1].low &&
      window[i].low < window[i + 2].low
    ) {
      lows.push(window[i].low);
    }
  }
  const cluster = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const groups: number[][] = [];
    for (const value of sorted) {
      const group = groups.find((g) => Math.abs(g[0] - value) / value < 0.012);
      if (group) group.push(value);
      else groups.push([value]);
    }
    return groups
      .map((g) => g.reduce((a, b) => a + b, 0) / g.length)
      .sort((a, b) => a - b);
  };
  const last = closes.at(-1) ?? 0;
  const support = cluster(lows)
    .filter((v) => v < last)
    .slice(-3)
    .reverse();
  const resistance = cluster(highs)
    .filter((v) => v > last)
    .slice(0, 3);
  return { support, resistance };
}
