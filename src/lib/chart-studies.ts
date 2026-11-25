// Chart studies ("indicators") and chart signals, computed from OHLCV candles.
// Pure and client-safe: used by the chart in the browser and by the signal backtest script.
// Standard definitions (see the Glossary, Ch. 6–7).

import type { Candle } from "./types";

export type Point = { time: number; value: number };
export type Band = { upper: Point[]; middle: Point[]; lower: Point[] };

const pts = (c: Candle[], vals: Array<number | null>): Point[] =>
  vals.flatMap((v, i) => (v == null || !Number.isFinite(v) ? [] : [{ time: c[i].time, value: v }]));

export function emaValues(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = e;
  for (let i = period; i < values.length; i += 1) out[i] = e = values[i] * k + e * (1 - k);
  return out;
}

export function smaValues(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = Array(values.length).fill(null);
  let s = 0;
  for (let i = 0; i < values.length; i += 1) {
    s += values[i];
    if (i >= period) s -= values[i - period];
    if (i >= period - 1) out[i] = s / period;
  }
  return out;
}

/** Wilder ATR. */
export function atrValues(c: Candle[], period = 14): Array<number | null> {
  const out: Array<number | null> = Array(c.length).fill(null);
  const tr = c.map((x, i) => (i === 0 ? x.high - x.low : Math.max(x.high - x.low, Math.abs(x.high - c[i - 1].close), Math.abs(x.low - c[i - 1].close))));
  let prev: number | null = null;
  for (let i = period - 1; i < c.length; i += 1) {
    prev = prev == null ? tr.slice(0, period).reduce((a, b) => a + b, 0) / period : (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

export const ema = (c: Candle[], period: number) => pts(c, emaValues(c.map((x) => x.close), period));
export const sma = (c: Candle[], period: number) => pts(c, smaValues(c.map((x) => x.close), period));

/** Bollinger Bands: SMA(20) ± 2 population standard deviations. */
export function bollinger(c: Candle[], period = 20, mult = 2): Band {
  const closes = c.map((x) => x.close);
  const mid = smaValues(closes, period);
  const up: Array<number | null> = [];
  const lo: Array<number | null> = [];
  for (let i = 0; i < c.length; i += 1) {
    if (mid[i] == null) {
      up.push(null);
      lo.push(null);
      continue;
    }
    const w = closes.slice(i - period + 1, i + 1);
    const sd = Math.sqrt(w.reduce((a, b) => a + (b - mid[i]!) ** 2, 0) / period);
    up.push(mid[i]! + mult * sd);
    lo.push(mid[i]! - mult * sd);
  }
  return { upper: pts(c, up), middle: pts(c, mid), lower: pts(c, lo) };
}

/** Keltner Channels: EMA(20) ± 2 × ATR(10). */
export function keltner(c: Candle[], period = 20, atrPeriod = 10, mult = 2): Band {
  const mid = emaValues(c.map((x) => x.close), period);
  const atr = atrValues(c, atrPeriod);
  const up = mid.map((m, i) => (m == null || atr[i] == null ? null : m + mult * atr[i]!));
  const lo = mid.map((m, i) => (m == null || atr[i] == null ? null : m - mult * atr[i]!));
  return { upper: pts(c, up), middle: pts(c, mid), lower: pts(c, lo) };
}

/** Donchian Channels: highest high / lowest low of the previous `period` bars. */
export function donchian(c: Candle[], period = 20): Band {
  const up: Array<number | null> = [];
  const lo: Array<number | null> = [];
  for (let i = 0; i < c.length; i += 1) {
    if (i < period - 1) {
      up.push(null);
      lo.push(null);
      continue;
    }
    const w = c.slice(i - period + 1, i + 1);
    up.push(Math.max(...w.map((x) => x.high)));
    lo.push(Math.min(...w.map((x) => x.low)));
  }
  return { upper: pts(c, up), middle: pts(c, up.map((u, i) => (u == null || lo[i] == null ? null : (u + lo[i]!) / 2))), lower: pts(c, lo) };
}

/**
 * Supertrend(10, 3): ATR bands around (high+low)/2 that ratchet with the trend; the line sits below
 * price in an uptrend and above it in a downtrend. `dir` is +1 (up) or −1 (down) per bar.
 */
export function supertrend(c: Candle[], period = 10, mult = 3) {
  const atr = atrValues(c, period);
  const dir: Array<1 | -1 | 0> = Array(c.length).fill(0);
  const line: Array<number | null> = Array(c.length).fill(null);
  let upper = 0;
  let lower = 0;
  for (let i = 0; i < c.length; i += 1) {
    const a = atr[i];
    if (a == null) continue;
    const hl2 = (c[i].high + c[i].low) / 2;
    const basicU = hl2 + mult * a;
    const basicL = hl2 - mult * a;
    const first = dir[i - 1] === 0 || i === 0;
    upper = first || basicU < upper || c[i - 1].close > upper ? basicU : upper;
    lower = first || basicL > lower || c[i - 1].close < lower ? basicL : lower;
    const prevDir = first ? 1 : dir[i - 1];
    dir[i] = prevDir === 1 ? (c[i].close < lower ? -1 : 1) : c[i].close > upper ? 1 : -1;
    line[i] = dir[i] === 1 ? lower : upper;
  }
  return { up: pts(c, line.map((v, i) => (dir[i] === 1 ? v : null))), down: pts(c, line.map((v, i) => (dir[i] === -1 ? v : null))), dir };
}

/** Parabolic SAR (Wilder): step 0.02, maximum 0.2. */
export function parabolicSar(c: Candle[], step = 0.02, max = 0.2): Point[] {
  if (c.length < 3) return [];
  const out: Point[] = [];
  let up = c[1].close >= c[0].close;
  let sar = up ? c[0].low : c[0].high;
  let ep = up ? c[1].high : c[1].low;
  let af = step;
  for (let i = 1; i < c.length; i += 1) {
    sar = sar + af * (ep - sar);
    if (up) {
      sar = Math.min(sar, c[i - 1].low, c[Math.max(0, i - 2)].low);
      if (c[i].low < sar) {
        up = false;
        sar = ep;
        ep = c[i].low;
        af = step;
      } else if (c[i].high > ep) {
        ep = c[i].high;
        af = Math.min(max, af + step);
      }
    } else {
      sar = Math.max(sar, c[i - 1].high, c[Math.max(0, i - 2)].high);
      if (c[i].high > sar) {
        up = true;
        sar = ep;
        ep = c[i].high;
        af = step;
      } else if (c[i].low < ep) {
        ep = c[i].low;
        af = Math.min(max, af + step);
      }
    }
    out.push({ time: c[i].time, value: sar });
  }
  return out;
}

/**
 * Ichimoku Kinko Hyo (9, 26, 52). Senkou spans are plotted 26 bars ahead, using the candle spacing
 * to place future times; the lagging span is plotted 26 bars back.
 */
export function ichimoku(c: Candle[], conv = 9, base = 26, spanB = 52, shift = 26) {
  const mid = (i: number, n: number) => {
    if (i < n - 1) return null;
    const w = c.slice(i - n + 1, i + 1);
    return (Math.max(...w.map((x) => x.high)) + Math.min(...w.map((x) => x.low))) / 2;
  };
  const step = c.length > 1 ? c.at(-1)!.time - c.at(-2)!.time : 86400;
  const timeAt = (i: number) => (i < c.length ? c[i].time : c.at(-1)!.time + (i - c.length + 1) * step);
  const tenkan: Point[] = [];
  const kijun: Point[] = [];
  const spanA: Point[] = [];
  const spanBPts: Point[] = [];
  const lagging: Point[] = [];
  for (let i = 0; i < c.length; i += 1) {
    const t = mid(i, conv);
    const k = mid(i, base);
    const b = mid(i, spanB);
    if (t != null) tenkan.push({ time: c[i].time, value: t });
    if (k != null) kijun.push({ time: c[i].time, value: k });
    if (t != null && k != null) spanA.push({ time: timeAt(i + shift), value: (t + k) / 2 });
    if (b != null) spanBPts.push({ time: timeAt(i + shift), value: b });
    if (i - shift >= 0) lagging.push({ time: c[i - shift].time, value: c[i].close });
  }
  return { tenkan, kijun, spanA, spanB: spanBPts, lagging };
}

/** Session VWAP for intraday candles: resets each IST trading day. */
export function sessionVwap(c: Candle[]): Point[] {
  const out: Point[] = [];
  let day = -1;
  let pv = 0;
  let v = 0;
  for (const x of c) {
    const d = Math.floor((x.time + 19800) / 86400);
    if (d !== day) {
      day = d;
      pv = 0;
      v = 0;
    }
    pv += ((x.high + x.low + x.close) / 3) * x.volume;
    v += x.volume;
    if (v > 0) out.push({ time: x.time, value: pv / v });
  }
  return out;
}

/* ------------------------------------------- signals ------------------------------------------- */

export type ChartSignal = {
  time: number;
  side: "buy" | "sell";
  source: "supertrend" | "golden-cross" | "engine" | "structure" | "pattern";
  label: string;
  detail: string;
};

/** Supertrend direction flips: buy when it turns up, sell when it turns down. */
export function supertrendSignals(c: Candle[]): ChartSignal[] {
  const { dir } = supertrend(c);
  const out: ChartSignal[] = [];
  for (let i = 1; i < c.length; i += 1) {
    if (dir[i - 1] === 0 || dir[i] === dir[i - 1]) continue;
    out.push({
      time: c[i].time,
      side: dir[i] === 1 ? "buy" : "sell",
      source: "supertrend",
      label: dir[i] === 1 ? "ST ▲" : "ST ▼",
      detail: `Supertrend(10, 3) turned ${dir[i] === 1 ? "up" : "down"} at ${c[i].close.toFixed(2)}`,
    });
  }
  return out;
}

/** 50-day SMA crossing the 200-day SMA (needs daily candles). */
export function crossSignals(c: Candle[]): ChartSignal[] {
  const closes = c.map((x) => x.close);
  const s50 = smaValues(closes, 50);
  const s200 = smaValues(closes, 200);
  const out: ChartSignal[] = [];
  for (let i = 1; i < c.length; i += 1) {
    if (s50[i] == null || s200[i] == null || s50[i - 1] == null || s200[i - 1] == null) continue;
    const before = s50[i - 1]! - s200[i - 1]!;
    const now = s50[i]! - s200[i]!;
    if (before <= 0 && now > 0) out.push({ time: c[i].time, side: "buy", source: "golden-cross", label: "Golden ×", detail: "50-day average crossed above the 200-day" });
    if (before >= 0 && now < 0) out.push({ time: c[i].time, side: "sell", source: "golden-cross", label: "Death ×", detail: "50-day average crossed below the 200-day" });
  }
  return out;
}
