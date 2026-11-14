/**
 * Out-of-sample track record of the BUY/SELL markers drawn on the chart.
 * Supertrend flips are measured over 10 trading days, golden/death crosses over 60, after a 0.3%
 * round-trip cost, on the newest 40% of dates (the rules were not tuned on any of this data).
 * Writes src/lib/signal-stats.json, which the chart legend displays.
 *
 * Run: npm run backtest:signals -- [--cache <candles.json>]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { THRESHOLDS } from "../lib/agents/thresholds";
import { crossSignals, supertrendSignals, type ChartSignal } from "../lib/chart-studies";
import { getAllStocks } from "../lib/stock-universe";
import type { Candle } from "../lib/types";
import { fetchChart } from "../lib/yahoo";

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const CACHE = arg("cache");
const OUT = "src/lib/signal-stats.json";
const COST = THRESHOLDS.costs.deliveryRoundTripPct / 100;
const P = THRESHOLDS.proven;

async function load(): Promise<Record<string, Candle[]>> {
  if (CACHE && existsSync(CACHE)) return JSON.parse(readFileSync(CACHE, "utf8"));
  const out: Record<string, Candle[]> = {};
  for (const s of getAllStocks()) {
    try {
      out[s] = (await fetchChart(s, "5y", "1d")).candles;
    } catch {
      /* skip */
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  if (CACHE) writeFileSync(CACHE, JSON.stringify(out));
  return out;
}

type Trade = { t: number; side: "buy" | "sell"; fwd: number };

function stats(trades: Trade[], baseline: number) {
  const r = trades.map((x) => (x.side === "buy" ? x.fwd : -x.fwd) - COST);
  const n = r.length;
  const wins = r.filter((x) => x > 0);
  const gw = wins.reduce((a, b) => a + b, 0);
  const gl = -r.filter((x) => x <= 0).reduce((a, b) => a + b, 0);
  const meanFwd = n ? trades.reduce((a, b) => a + b.fwd, 0) / n : 0;
  const side = trades[0]?.side ?? "buy";
  const hitRate = n ? wins.length / n : 0;
  const expectancy = n ? r.reduce((a, b) => a + b, 0) / n : 0;
  const profitFactor = gl ? gw / gl : 0;
  const edge = side === "buy" ? meanFwd - baseline : baseline - meanFwd;
  const proven = n >= P.minSignals && hitRate >= P.minHitRate && profitFactor >= P.minProfitFactor && expectancy > 0 && edge > 0;
  const r4 = (x: number) => Number(x.toFixed(4));
  return { n, hitRate: r4(hitRate), expectancy: r4(expectancy), profitFactor: r4(profitFactor), edge: r4(edge), proven };
}

async function main() {
  const data = await load();
  const sources: Array<{ key: "supertrend" | "golden-cross"; horizon: number; gen: (c: Candle[]) => ChartSignal[] }> = [
    { key: "supertrend", horizon: 10, gen: supertrendSignals },
    { key: "golden-cross", horizon: 60, gen: crossSignals },
  ];
  const result: Record<string, unknown> = { generatedAt: new Date().toISOString(), stocks: Object.keys(data).length, costRoundTrip: COST };
  for (const src of sources) {
    const trades: Trade[] = [];
    const allFwd: Array<{ t: number; fwd: number }> = [];
    for (const c of Object.values(data)) {
      const idx = new Map(c.map((x, i) => [x.time, i]));
      for (let i = 200; i < c.length - src.horizon; i += 1) allFwd.push({ t: c[i].time, fwd: c[i + src.horizon].close / c[i].close - 1 });
      for (const s of src.gen(c)) {
        const i = idx.get(s.time)!;
        if (i < 200 || i + src.horizon >= c.length) continue;
        trades.push({ t: s.time, side: s.side, fwd: c[i + src.horizon].close / c[i].close - 1 });
      }
    }
    const times = allFwd.map((x) => x.t);
    const tMin = Math.min(...times);
    const tMax = Math.max(...times);
    const cut = tMin + (tMax - tMin) * 0.6;
    const test = trades.filter((x) => x.t >= cut);
    const baseTest = allFwd.filter((x) => x.t >= cut);
    const baseline = baseTest.reduce((a, b) => a + b.fwd, 0) / baseTest.length;
    const day = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
    const buy = stats(test.filter((x) => x.side === "buy"), baseline);
    const sell = stats(test.filter((x) => x.side === "sell"), baseline);
    result[src.key] = { horizonDays: src.horizon, period: `${day(cut)} to ${day(tMax)}`, baselineMean: Number(baseline.toFixed(4)), buy, sell };
    const fmt = (s: ReturnType<typeof stats>) => `n=${s.n} hit=${(s.hitRate * 100).toFixed(1)}% exp=${(s.expectancy * 100).toFixed(2)}% PF=${s.profitFactor.toFixed(2)} edge=${(s.edge * 100).toFixed(2)}% ${s.proven ? "PROVEN" : "unproven"}`;
    console.log(`${src.key} (${src.horizon}d, test ${day(cut)}→${day(tMax)}, avg stock ${(baseline * 100).toFixed(2)}%)\n  BUY  ${fmt(buy)}\n  SELL ${fmt(sell)}`);
  }
  writeFileSync(OUT, JSON.stringify(result, null, 2) + "\n");
  console.log(`\nWrote ${OUT}`);
}

void main();
