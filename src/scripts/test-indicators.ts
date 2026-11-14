/**
 * Formula checks for the indicator engine against reference values.
 * Run: npm run test:indicators
 */
import { barsPerYear, computeIndicators } from "../lib/indicators";
import type { Candle } from "../lib/types";

let fail = 0;
const check = (name: string, got: number | null, want: number, tol: number) => {
  const ok = got != null && Math.abs(got - want) <= tol;
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(46)} got ${got?.toFixed(4)}  want ${want}`);
};
const candlesFrom = (closes: number[], spread = 0.5, step = 86400): Candle[] =>
  closes.map((c, i) => ({ time: 1_700_000_000 + i * step, open: c, high: c + spread, low: c - spread, close: c, volume: 1000 + i }));

// 1. Wilder RSI — StockCharts worked example.
const rsiCloses = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64];
// Exact first value by hand: avg gain 3.34/14, avg loss 1.40/14 → RS 2.385714 → RSI 70.4641.
// StockCharts publishes 70.53 because it rounds RS to 2.39; later values carry that rounding.
check("RSI(14) day 15 exact hand calculation", computeIndicators(candlesFrom(rsiCloses.slice(0, 15))).rsi, 100 - 100 / (1 + 3.34 / 1.4), 1e-9);
const rsiWant = [70.53, 66.32, 66.55, 69.41, 66.36, 57.97];
rsiWant.forEach((want, j) => check(`RSI(14) StockCharts day ${15 + j} (rounded ref)`, computeIndicators(candlesFrom(rsiCloses.slice(0, 15 + j))).rsi, want, 0.08));

// 2. RSI edge cases.
check("RSI flat price = 50", computeIndicators(candlesFrom(Array(30).fill(100))).rsi, 50, 1e-9);
check("RSI only gains = 100", computeIndicators(candlesFrom(Array.from({ length: 30 }, (_, i) => 100 + i))).rsi, 100, 1e-9);

// 3. MACD vs an independent reference implementation.
const series = Array.from({ length: 120 }, (_, i) => 100 + 10 * Math.sin(i / 7) + i * 0.3);
const refEma = (xs: number[], p: number) => {
  const k = 2 / (p + 1);
  const out: number[] = [];
  let prev = xs.slice(0, p).reduce((a, b) => a + b, 0) / p;
  out[p - 1] = prev;
  for (let i = p; i < xs.length; i++) out[i] = prev = xs[i] * k + prev * (1 - k);
  return out;
};
const e12 = refEma(series, 12);
const e26 = refEma(series, 26);
const macdRef = series.map((_, i) => (i >= 25 ? e12[i] - e26[i] : NaN)).slice(25);
const sigRef = refEma(macdRef, 9);
const ind = computeIndicators(candlesFrom(series));
check("MACD line vs reference", ind.macd, macdRef.at(-1)!, 1e-9);
check("MACD signal vs reference (no zero-padding)", ind.macdSignal, sigRef.at(-1)!, 1e-9);
check("MACD histogram vs reference", ind.macdHistogram, macdRef.at(-1)! - sigRef.at(-1)!, 1e-9);

// 4. Wilder ATR by hand: constant true range of 2 → ATR 2; then one TR of 16 → (2·13 + 16)/14 = 3.
const atrCandles = candlesFrom(Array(20).fill(100), 1);
check("ATR(14) constant range", computeIndicators(atrCandles).atr, 2, 1e-9);
atrCandles.push({ time: atrCandles.at(-1)!.time + 86400, open: 100, high: 108, low: 92, close: 100, volume: 1 });
check("ATR(14) Wilder update (2·13+16)/14", computeIndicators(atrCandles).atr, 3, 1e-9);

// 5. ADX / DMI behaviour.
const up = computeIndicators(candlesFrom(Array.from({ length: 80 }, (_, i) => 100 + i), 0.5));
const ok1 = (up.plusDI ?? 0) > (up.minusDI ?? 0) && (up.adx ?? 0) > 40;
if (!ok1) fail++;
console.log(`${ok1 ? "PASS" : "FAIL"}  ADX steady uptrend: +DI ${up.plusDI?.toFixed(1)} > -DI ${up.minusDI?.toFixed(1)}, ADX ${up.adx?.toFixed(1)} > 40`);
const chop = computeIndicators(candlesFrom(Array.from({ length: 80 }, (_, i) => 100 + (i % 2 ? 1 : -1)), 1.2));
const ok2 = (chop.adx ?? 99) < 20;
if (!ok2) fail++;
console.log(`${ok2 ? "PASS" : "FAIL"}  ADX sideways chop < 20: ADX ${chop.adx?.toFixed(1)}`);

// 6. Volatility annualisation by bar size.
check("barsPerYear daily", barsPerYear(candlesFrom(Array(30).fill(1))), 252, 0);
check("barsPerYear weekly", barsPerYear(candlesFrom(Array(30).fill(1), 0.5, 7 * 86400)), 52, 0);
check("barsPerYear 15-min (25 bars/session)", barsPerYear(candlesFrom(Array(30).fill(1), 0.5, 900)), 252 * 25, 0);

// 7. Relative volume excludes the current bar.
const rv = candlesFrom(Array(30).fill(100));
rv.forEach((c) => (c.volume = 1000));
rv[rv.length - 1].volume = 3000;
check("Relative volume = 3000 / avg(prior 20)", computeIndicators(rv).volumeRatio, 3, 1e-9);

console.log(fail ? `\n${fail} FAILED` : "\nALL INDICATOR TESTS PASS");
process.exit(fail ? 1 : 0);
