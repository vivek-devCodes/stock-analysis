/**
 * Checks for the per-stock risk and verdict calculations on synthetic data with known answers.
 * Run: npm run test:insights
 */
import { betaVs, maxDrawdown, quickVerdict, returnsOf, riskProfile, var95 } from "../lib/insights/compute";
import type { Candle } from "../lib/types";

let fail = 0;
const check = (name: string, got: number | null | string, want: number | string, tol = 1e-9) => {
  const ok = typeof want === "string" ? got === want : got != null && typeof got === "number" && Math.abs(got - want) <= tol;
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(50)} got ${typeof got === "number" ? got.toFixed(4) : got}  want ${want}`);
};
const day = 86400;
const series = (closes: number[], volume = 1_000_000): Candle[] =>
  closes.map((c, i) => ({ time: 1_700_000_000 + i * day, open: c, high: c * 1.01, low: c * 0.99, close: c, volume }));

// Max drawdown: 100 → 120 → 90 → 110 = worst fall 120 → 90 = −25%.
check("max drawdown 120 → 90", maxDrawdown(series([100, 120, 90, 110])), -0.25);

// Returns: 1 day and 21 sessions back.
const lin = series(Array.from({ length: 70 }, (_, i) => 100 + i));
check("1-day return", returnsOf(lin).d1, 169 / 168 - 1);
check("1-month (21 sessions) return", returnsOf(lin).m1, 169 / 148 - 1);
check("3-month (63 sessions) return", returnsOf(lin).m3, 169 / 106 - 1);

// Beta: a stock that moves exactly 2× the market's daily return has beta 2.
const mkt: number[] = [100];
const stk: number[] = [100];
for (let i = 1; i < 260; i += 1) {
  const r = 0.01 * Math.sin(i * 1.7);
  mkt.push(mkt[i - 1] * (1 + r));
  stk.push(stk[i - 1] * (1 + 2 * r));
}
check("beta of a 2× stock", betaVs(series(stk), series(mkt)), 2, 1e-6);
check("beta of the market vs itself", betaVs(series(mkt), series(mkt)), 1, 1e-9);

// VaR 95%: 100 daily returns, five of them −5%, the rest +1% → 5th percentile is −5%.
const closes = [100];
for (let i = 1; i <= 100; i += 1) closes.push(closes[i - 1] * (i % 20 === 0 ? 0.95 : 1.01));
check("1-day VaR 95%", var95(series(closes)), -0.05, 1e-9);

// Risk level: calm, liquid series → LOW; violent series → HIGH.
const calm = series(Array.from({ length: 260 }, (_, i) => 100 * (1 + 0.002 * Math.sin(i))), 5_000_000);
// (vs an unrelated market series: a stock compared with itself has beta 1.0, which is deliberately MEDIUM)
check("calm liquid stock, low beta → LOW risk", riskProfile(calm, series(mkt)).level, "LOW");
const wild = series(Array.from({ length: 260 }, (_, i) => 100 * (1 + 0.25 * Math.sin(i / 3)) * (i > 200 ? 0.7 : 1)), 5_000_000);
check("volatile stock with a 30% fall → HIGH risk", riskProfile(wild, calm).level, "HIGH");
check("illiquid stock (₹0.1 crore/day) → HIGH risk", riskProfile(series(Array(260).fill(100), 1000), calm).level, "HIGH");

// Verdict: uptrend + strong fundamentals + not high risk → CONSIDER long term; downtrend + weak → AVOID.
const up = series(Array.from({ length: 260 }, (_, i) => 100 + i * 0.5), 5_000_000);
const upRisk = riskProfile(up, up);
check("uptrend + fundamentals 80 → CONSIDER", quickVerdict({ daily: up, insight: null, fundamentalScore: 80, flags: [], risk: upRisk }).stance, "CONSIDER");
const down = series(Array.from({ length: 260 }, (_, i) => 300 - i * 0.5), 5_000_000);
check("downtrend + fundamentals 30 → AVOID", quickVerdict({ daily: down, insight: null, fundamentalScore: 30, flags: [], risk: riskProfile(down, down) }).stance, "AVOID");
check("negative net worth flag → AVOID", quickVerdict({ daily: up, insight: null, fundamentalScore: 80, flags: ["Negative net worth"], risk: upRisk }).stance, "AVOID");

console.log(fail ? `\n${fail} FAILED` : "\nALL INSIGHT TESTS PASS");
process.exit(fail ? 1 : 0);
