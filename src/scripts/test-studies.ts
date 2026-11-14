/**
 * Formula checks for the chart studies and chart signals on data with known answers.
 * Run: npm run test:studies
 */
import { bollinger, crossSignals, donchian, ichimoku, keltner, parabolicSar, sessionVwap, supertrend, supertrendSignals } from "../lib/chart-studies";
import type { Candle } from "../lib/types";

let fail = 0;
const ok = (cond: boolean, name: string, info = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${info ? `  (${info})` : ""}`);
};
const D = 86400;
const bars = (closes: number[], spread = 1, step = D, start = 1_700_000_000): Candle[] =>
  closes.map((c, i) => ({ time: start + i * step, open: c, high: c + spread, low: c - spread, close: c, volume: 1000 }));

// Donchian: highest high / lowest low of the last 20 bars.
const ramp = bars(Array.from({ length: 40 }, (_, i) => 100 + i));
const dc = donchian(ramp, 20);
ok(dc.upper.at(-1)!.value === 140 && dc.lower.at(-1)!.value === 119, "Donchian(20) upper = 139+1, lower = 120−1", `${dc.upper.at(-1)!.value}/${dc.lower.at(-1)!.value}`);

// Bollinger on a flat series collapses to the price.
const flat = bollinger(bars(Array(30).fill(50)), 20);
ok(flat.upper.at(-1)!.value === 50 && flat.lower.at(-1)!.value === 50, "Bollinger on flat price = price (zero σ)");

// Keltner on a flat series: EMA = price, ATR = 2 (range high−low) → ±4.
const k = keltner(bars(Array(40).fill(100), 1), 20, 10, 2);
ok(Math.abs(k.upper.at(-1)!.value - 104) < 1e-9 && Math.abs(k.lower.at(-1)!.value - 96) < 1e-9, "Keltner = EMA ± 2×ATR (100 ± 4)");

// Supertrend: steady rise → up; then a sharp fall → flips down, with one sell signal.
const upThenDown = bars([...Array.from({ length: 40 }, (_, i) => 100 + i * 2), ...Array.from({ length: 20 }, (_, i) => 178 - i * 6)]);
const st = supertrend(upThenDown);
ok(st.dir[39] === 1, "Supertrend is UP after a steady rise");
ok(st.dir.at(-1) === -1, "Supertrend flips DOWN after a sharp fall");
const sts = supertrendSignals(upThenDown);
ok(sts.length === 1 && sts[0].side === "sell", "exactly one Supertrend SELL signal at the reversal", `${sts.length} signal(s)`);

// Parabolic SAR sits below price in an uptrend.
const psar = parabolicSar(ramp);
ok(psar.slice(5).every((p, i) => p.value < ramp[i + 6].low + 1e-9), "Parabolic SAR stays below price in an uptrend");

// Session VWAP: resets each day; two days of constant prices → VWAP equals that day's price.
const intraday: Candle[] = [
  ...Array.from({ length: 5 }, (_, i) => ({ time: 1_700_000_000 + i * 900, open: 10, high: 10, low: 10, close: 10, volume: 100 })),
  ...Array.from({ length: 5 }, (_, i) => ({ time: 1_700_000_000 + D + i * 900, open: 20, high: 20, low: 20, close: 20, volume: 100 })),
];
const vw = sessionVwap(intraday);
ok(vw[4].value === 10 && vw[9].value === 20, "VWAP resets at each IST session", `${vw[4].value}, ${vw[9].value}`);

// Ichimoku: Senkou spans are projected 26 bars into the future.
const ich = ichimoku(bars(Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 5) * 10)));
ok(ich.spanB.at(-1)!.time === 1_700_000_000 + (79 + 26) * D, "Ichimoku Senkou B plotted 26 bars ahead");

// Golden cross: falling then rising long enough for SMA50 to cross above SMA200.
const vee = bars([...Array.from({ length: 220 }, (_, i) => 300 - i), ...Array.from({ length: 200 }, (_, i) => 81 + i * 2)]);
const cs = crossSignals(vee);
ok(cs.some((s) => s.side === "buy" && s.source === "golden-cross"), "Golden cross detected after a V-shaped recovery");

console.log(fail ? `\n${fail} FAILED` : "\nALL STUDY TESTS PASS");
process.exit(fail ? 1 : 0);
