/**
 * Walk-forward backtest of the daily BUY / HOLD / SELL engine.
 *
 * For every stock in the universe and every trading day with enough history, it computes the
 * recommendation using ONLY data up to that day (no look-ahead), then measures the actual
 * return over the next H trading days. It reports how often BUY/SELL calls were right and
 * builds a calibration table (score bucket → historical hit rate) for the confidence figure.
 *
 * Usage:
 *   npx tsx src/scripts/backtest.ts                 # fetch fresh data, horizon 10
 *   npx tsx src/scripts/backtest.ts --cache <file>  # reuse/save candles (fair before/after runs)
 *   npx tsx src/scripts/backtest.ts --horizon 5 --out <file.json>
 *
 * Caveat: samples overlap (daily steps, multi-day horizon), so results are autocorrelated;
 * treat hit rates as indicative, not statistically independent trials.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { buildInsight } from "../lib/analysis";
import { computeIndicators } from "../lib/indicators";
import { getAllStocks } from "../lib/stock-universe";
import type { Candle, Quote } from "../lib/types";
import { fetchChart } from "../lib/yahoo";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

const H = Number(arg("horizon") ?? 10);
const WARMUP = 210; // SMA200 needs 200 bars
const CACHE = arg("cache");
const OUT = arg("out");
const CALIBRATION = arg("calibration");
const RANGE = arg("range") ?? "5y"; // daily candles over this range
const LOOKBACK = 300; // indicators only need ~250 bars; a fixed window keeps the run fast
const TRAIN_FRACTION = 0.6; // older 60% of dates = design period; newest 40% = untouched test period
// Round-trip trading cost for a delivery trade in India: STT 0.1% each side, plus brokerage,
// exchange/SEBI charges, stamp duty, GST and slippage — about 0.3% in total.
const COST = Number(arg("cost") ?? 0.003);
// A call is "proven" only if, out of sample, it beats the average stock AND makes money after costs.
const PROVEN = { minN: 200, minHit: 0.55, minProfitFactor: 1.1 };

async function loadCandles(): Promise<Record<string, Candle[]>> {
  if (CACHE && existsSync(CACHE)) return JSON.parse(readFileSync(CACHE, "utf8"));
  const out: Record<string, Candle[]> = {};
  for (const symbol of getAllStocks()) {
    try {
      const { candles } = await fetchChart(symbol, RANGE, "1d");
      out[symbol] = candles;
      process.stdout.write(".");
    } catch {
      process.stdout.write("x");
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  process.stdout.write("\n");
  if (CACHE) writeFileSync(CACHE, JSON.stringify(out));
  return out;
}

function quoteAt(symbol: string, candles: Candle[], i: number): Quote {
  const c = candles[i];
  const prev = candles[i - 1]?.close ?? c.close;
  return {
    symbol, name: symbol, exchange: "NSE", currency: "INR", price: c.close, change: c.close - prev,
    changePercent: ((c.close - prev) / prev) * 100, previousClose: prev, open: c.open, dayHigh: c.high,
    dayLow: c.low, volume: c.volume, averageVolume: null, marketCap: null, pe: null, eps: null,
    fiftyTwoWeekHigh: null, fiftyTwoWeekLow: null, dividendYield: null, beta: null, sector: null,
    industry: null, marketState: "CLOSED",
  };
}

type Sample = { rec: string; score: number; fwd: number; time: number };

function stats(xs: number[]) {
  if (!xs.length) return { n: 0, mean: 0, median: 0, pctUp: 0 };
  const s = [...xs].sort((a, b) => a - b);
  return {
    n: xs.length,
    mean: xs.reduce((a, b) => a + b, 0) / xs.length,
    median: s[Math.floor(s.length / 2)],
    pctUp: xs.filter((x) => x > 0).length / xs.length,
  };
}

/**
 * Trade metrics (glossary 11.1). r = return of the trade: +fwd for BUY, -fwd for SELL (short or
 * avoid), net of round-trip costs. Hit rate = share of trades with r > 0; profit factor = gross
 * gains / gross losses; expectancy = average r; payoff ratio = average win / average loss.
 */
function tradeStats(fwd: number[], side: 1 | -1, baselineMean: number) {
  const r = fwd.map((f) => side * f - COST);
  const wins = r.filter((x) => x > 0);
  const losses = r.filter((x) => x <= 0);
  const sumW = wins.reduce((a, b) => a + b, 0);
  const sumL = -losses.reduce((a, b) => a + b, 0);
  const n = r.length;
  const meanFwd = n ? fwd.reduce((a, b) => a + b, 0) / n : 0;
  const t = {
    n,
    hitRate: n ? wins.length / n : 0,
    expectancy: n ? r.reduce((a, b) => a + b, 0) / n : 0,
    profitFactor: sumL ? sumW / sumL : sumW ? Infinity : 0,
    payoffRatio: wins.length && losses.length ? sumW / wins.length / (sumL / losses.length) : 0,
    // Edge vs simply holding the average stock over the same days (before costs).
    edge: side === 1 ? meanFwd - baselineMean : baselineMean - meanFwd,
  };
  const proven = t.n >= PROVEN.minN && t.hitRate >= PROVEN.minHit && t.edge > 0 && t.expectancy > 0 && t.profitFactor >= PROVEN.minProfitFactor;
  return { ...t, proven };
}

const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
const r4 = (x: number) => (Number.isFinite(x) ? Number(x.toFixed(4)) : 0);

async function main() {
  const data = await loadCandles();
  const samples: Sample[] = [];
  const t0 = Date.now();
  for (const [symbol, candles] of Object.entries(data)) {
    for (let i = WARMUP; i < candles.length - H; i += 1) {
      const slice = candles.slice(Math.max(0, i + 1 - LOOKBACK), i + 1);
      const ind = computeIndicators(slice);
      const insight = buildInsight(quoteAt(symbol, candles, i), slice, ind, []);
      samples.push({ rec: insight.recommendation, score: insight.score, fwd: candles[i + H].close / candles[i].close - 1, time: candles[i].time });
    }
  }

  const times = samples.map((x) => x.time);
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);
  const cutoff = tMin + (tMax - tMin) * TRAIN_FRACTION;
  const day = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

  const report = (label: string, xs: Sample[]) => {
    const base = stats(xs.map((x) => x.fwd));
    const fwdOf = (rec: string) => xs.filter((x) => x.rec === rec).map((x) => x.fwd);
    const buy = tradeStats(fwdOf("BUY"), 1, base.mean);
    const sell = tradeStats(fwdOf("SELL"), -1, base.mean);
    const hold = stats(fwdOf("HOLD"));
    const line = (name: string, t: ReturnType<typeof tradeStats>) =>
      `  ${name}: n=${String(t.n).padStart(6)}  hit=${pct(t.hitRate)}  expectancy(net)=${pct(t.expectancy)}  PF=${t.profitFactor.toFixed(2)}  payoff=${t.payoffRatio.toFixed(2)}  edge=${pct(t.edge)}  ${t.proven ? "PROVEN" : "unproven"}`;
    console.log(`\n${label} · ${xs.length} samples · costs ${pct(COST)} round trip`);
    console.log(`  Average stock (every day): mean fwd ${pct(base.mean)}, up ${pct(base.pctUp)} of the time`);
    console.log(line("BUY ", buy));
    console.log(line("SELL", sell));
    console.log(`  HOLD: n=${hold.n} mean fwd=${pct(hold.mean)}`);
    return { base, buy, sell, hold };
  };

  console.log(`\nWalk-forward backtest · ${Object.keys(data).length} stocks · ${RANGE} daily · horizon ${H} trading days · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  report(`ALL ${day(tMin)} → ${day(tMax)}`, samples);
  report(`TRAIN (design period) ${day(tMin)} → ${day(cutoff)}`, samples.filter((x) => x.time < cutoff));
  const test = report(`TEST (out-of-sample) ${day(cutoff)} → ${day(tMax)}`, samples.filter((x) => x.time >= cutoff));

  if (CALIBRATION) {
    const cal = (t: ReturnType<typeof tradeStats>) =>
      t.n
        ? { n: t.n, hitRate: r4(t.hitRate), expectancy: r4(t.expectancy), profitFactor: r4(t.profitFactor), payoffRatio: r4(t.payoffRatio), edge: r4(t.edge), proven: t.proven }
        : null;
    writeFileSync(
      CALIBRATION,
      JSON.stringify(
        {
          note: "Out-of-sample (test period) results of the daily BUY/SELL engine, from src/scripts/backtest.ts. Trade return = +fwd for BUY, -fwd for SELL, net of round-trip costs. edge = vs the average stock, before costs.",
          generatedAt: new Date().toISOString(),
          horizonDays: H,
          costRoundTrip: COST,
          stocks: Object.keys(data).length,
          period: `${day(cutoff)} to ${day(tMax)}`,
          provenRule: PROVEN,
          buy: cal(test.buy),
          sell: cal(test.sell),
          baseline: { n: test.base.n, pctUp: r4(test.base.pctUp), mean: r4(test.base.mean) },
          caveats: [
            "Universe = today's large caps (survivorship bias: delisted stocks are missing).",
            "Daily samples overlap, so results are autocorrelated; treat as indicative.",
            "Past behaviour does not guarantee future results.",
          ],
        },
        null,
        2,
      ) + "\n",
    );
    console.log(`\nWrote calibration (test period only) to ${CALIBRATION}`);
  }
  const base = stats(samples.map((s) => s.fwd));
  const buy = stats(samples.filter((s) => s.rec === "BUY").map((s) => s.fwd));
  const sell = stats(samples.filter((s) => s.rec === "SELL").map((s) => s.fwd));

  // Calibration: probability the stock is higher after H days, by score bucket.
  const buckets: Array<{ lo: number; hi: number; n: number; pctUp: number; mean: number }> = [];
  for (let lo = -60; lo < 60; lo += 10) {
    const xs = samples.filter((s) => s.score >= lo && s.score < lo + 10).map((s) => s.fwd);
    if (xs.length >= 30) {
      const st = stats(xs);
      buckets.push({ lo, hi: lo + 10, n: st.n, pctUp: st.pctUp, mean: st.mean });
    }
  }
  console.log("\nScore bucket → % of times higher after", H, "days");
  for (const b of buckets) console.log(`  [${String(b.lo).padStart(3)}, ${String(b.hi).padStart(3)})  n=${String(b.n).padStart(5)}  up=${pct(b.pctUp)}  mean=${pct(b.mean)}`);

  if (OUT) {
    writeFileSync(
      OUT,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          horizonDays: H,
          stocks: Object.keys(data).length,
          samples: samples.length,
          baseline: base,
          buy: { ...buy, hitRate: buy.pctUp },
          sell: { ...sell, hitRate: 1 - sell.pctUp },
          buckets,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(`\nSaved ${OUT}`);
  }
}

void main();
