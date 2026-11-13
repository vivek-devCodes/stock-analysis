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

function ema(values: number[], period: number) {
  const out: Array<number | null> = Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let prev: number | null = null;
  for (let i = 0; i < values.length; i += 1) {
    if (i < period - 1) continue;
    if (prev == null) {
      const seed = values.slice(0, i + 1).reduce((a, b) => a + b, 0) / (i + 1);
      prev = seed;
      out[i] = seed;
    } else {
      prev = values[i] * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

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
        const rs = loss === 0 ? 100 : gain / loss;
        out[i] = 100 - 100 / (1 + rs);
      }
    } else {
      gain = (gain * (period - 1) + up) / period;
      loss = (loss * (period - 1) + down) / period;
      const rs = loss === 0 ? 100 : gain / loss;
      out[i] = 100 - 100 / (1 + rs);
    }
  }
  return out;
}

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

function atr(candles: Candle[], period = 14) {
  const out: Array<number | null> = Array(candles.length).fill(null);
  const trs: number[] = [];
  for (let i = 0; i < candles.length; i += 1) {
    if (i === 0) {
      trs.push(candles[i].high - candles[i].low);
    } else {
      trs.push(
        Math.max(
          candles[i].high - candles[i].low,
          Math.abs(candles[i].high - candles[i - 1].close),
          Math.abs(candles[i].low - candles[i - 1].close),
        ),
      );
    }
  }
  let sum = 0;
  for (let i = 0; i < trs.length; i += 1) {
    sum += trs[i];
    if (i >= period) sum -= trs[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function stochastic(candles: Candle[], period = 14, smooth = 3) {
  const kRaw: Array<number | null> = Array(candles.length).fill(null);
  for (let i = period - 1; i < candles.length; i += 1) {
    const window = candles.slice(i - period + 1, i + 1);
    const highest = Math.max(...window.map((c) => c.high));
    const lowest = Math.min(...window.map((c) => c.low));
    const denom = highest - lowest || 1e-9;
    kRaw[i] = ((candles[i].close - lowest) / denom) * 100;
  }
  const k = sma(
    kRaw.map((v) => v ?? 0),
    smooth,
  );
  const d = sma(
    k.map((v) => v ?? 0),
    smooth,
  );
  return { k, d };
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

  const macdLine: Array<number | null> = closes.map((_, i) =>
    ema12[i] != null && ema26[i] != null ? (ema12[i] as number) - (ema26[i] as number) : null,
  );
  const macdSignal = ema(
    macdLine.map((v) => v ?? 0),
    9,
  );
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
  const realizedVol = Math.sqrt(variance) * Math.sqrt(252) * 100;

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
    volumeRatio:
      last(volumes) && last(volSma) ? (last(volumes) as number) / (last(volSma) as number) : null,
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
