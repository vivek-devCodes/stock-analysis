import { candlePatterns, dailyLevels, fairValueGaps, fibRetracement, levelAssessment, levelContext, marketStructure, nearestZones, pivotPoints, srZones, swingPoints, trendlines, volumeProfile, vwapBands } from "../lib/levels";
import type { Candle } from "../lib/types";
import { fetchChart } from "../lib/yahoo";

// npm run test:levels — the chart-level toolkit on synthetic candles with known answers, then live data.

let failed = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  (${extra})` : ""}`);
};
const DAY = 86400;
const mk = (closes: number[], wick = 0.5, vol = 1000): Candle[] =>
  closes.map((close, i) => {
    const open = i ? closes[i - 1] : close;
    return { time: 1_700_000_000 + i * DAY, open, high: Math.max(open, close) + wick, low: Math.min(open, close) - wick, close, volume: vol };
  });

/* range bouncing between ~100 and ~110 → support near 100, resistance near 110 */
const wave: number[] = [];
for (let k = 0; k < 6; k++) for (let i = 0; i <= 10; i++) wave.push(k % 2 === 0 ? 100 + i : 110 - i);
wave.push(104, 105);
const range = mk(wave, 0.3);

{
  const sw = swingPoints(range);
  check("swing highs and lows found", sw.filter((s) => s.kind === "high").length >= 2 && sw.filter((s) => s.kind === "low").length >= 2, `${sw.length} swings`);
  const zones = srZones(range);
  const { support, resistance } = nearestZones(zones, 105);
  check("support zone near 100", support != null && Math.abs(support.mid - 100) < 1.5, support ? `${support.low.toFixed(1)}–${support.high.toFixed(1)} ×${support.touches}` : "none");
  check("resistance zone near 110", resistance != null && Math.abs(resistance.mid - 110) < 1.5, resistance ? `${resistance.low.toFixed(1)}–${resistance.high.toFixed(1)} ×${resistance.touches}` : "none");
  check("zones have multiple touches", (support?.touches ?? 0) >= 2 && (resistance?.touches ?? 0) >= 2);
}

/* rising staircase with pullbacks → rising support trendline, bullish structure, BOS events */
const stairs: number[] = [];
let p = 100;
for (let k = 0; k < 8; k++) {
  for (let i = 0; i < 6; i++) stairs.push((p += 1.5));
  for (let i = 0; i < 3; i++) stairs.push((p -= 1.2));
}
const up = mk(stairs, 0.3);
{
  const tl = trendlines(up);
  check("rising support trendline in an uptrend", tl.some((t) => t.kind === "support" && t.slopePerBar > 0 && !t.broken), JSON.stringify(tl.map((t) => [t.kind, t.slopePerBar.toFixed(2), t.touches, t.broken])));
  const st = marketStructure(up);
  check("market structure bullish", st.trend === "bullish", st.trend);
  check("break-of-structure events up", st.events.some((e) => e.side === "buy" && e.label === "BOS"), st.events.map((e) => e.label + e.side).join(","));
  const fib = fibRetracement(up);
  check("Fibonacci measured on the up-move", fib?.direction === "up" && fib.levels.find((l) => l.ratio === 0.5)!.price < fib.to.value, fib ? `${fib.from.value.toFixed(1)}→${fib.to.value.toFixed(1)}` : "none");
}

/* down-trend that breaks up: CHoCH */
{
  const seq: number[] = [];
  let q = 150;
  for (let k = 0; k < 5; k++) {
    for (let i = 0; i < 5; i++) seq.push((q -= 1.5));
    for (let i = 0; i < 3; i++) seq.push((q += 1));
  }
  for (let i = 0; i < 12; i++) seq.push((q += 2));
  const st = marketStructure(mk(seq, 0.3));
  check("change of character when a downtrend breaks up", st.events.some((e) => e.label === "CHoCH" && e.side === "buy"), st.events.map((e) => e.label + e.side).join(","));
}

/* pivots */
{
  const pv = pivotPoints(110, 100, 105);
  check("classic pivot", Math.abs(pv.p - 105) < 1e-9 && Math.abs(pv.r1 - 110) < 1e-9 && Math.abs(pv.s1 - 100) < 1e-9, JSON.stringify({ p: pv.p, r1: pv.r1, s1: pv.s1 }));
  const dl = dailyLevels(range);
  check("previous-day levels from daily candles", dl != null && dl.pdh === range.at(-2)!.high && dl.pdl === range.at(-2)!.low);
}

/* volume profile: heavy volume at 105 → POC near 105 */
{
  const c = mk(Array.from({ length: 60 }, (_, i) => 100 + (i % 11)), 0.2).map((x) => ({ ...x, volume: Math.abs(x.close - 105) < 0.6 ? 20000 : 500 }));
  const vp = volumeProfile(c);
  check("volume profile POC at the heavy-volume price", vp != null && Math.abs(vp.poc - 105) < 1, vp ? `POC ${vp.poc.toFixed(2)} VA ${vp.val.toFixed(1)}–${vp.vah.toFixed(1)}` : "none");
  check("value area contains the POC", vp != null && vp.val <= vp.poc && vp.poc <= vp.vah);
}

/* VWAP bands */
{
  const intraday: Candle[] = Array.from({ length: 30 }, (_, i) => ({ time: 1_700_000_000 + i * 300, open: 100 + Math.sin(i / 3), high: 101 + Math.sin(i / 3), low: 99 + Math.sin(i / 3), close: 100 + Math.sin(i / 3 + 0.2), volume: 1000 }));
  const vb = vwapBands(intraday);
  check("VWAP bands are ordered", vb.vwap.every((v, i) => vb.dn2[i].value <= vb.dn1[i].value && vb.dn1[i].value <= v.value && v.value <= vb.up1[i].value && vb.up1[i].value <= vb.up2[i].value));
}

/* fair-value gap and patterns */
{
  const c: Candle[] = [
    { time: 1, open: 100, high: 101, low: 99, close: 100.5, volume: 1 },
    { time: 2, open: 101, high: 106, low: 100.8, close: 105.5, volume: 1 },
    { time: 3, open: 105.6, high: 107, low: 103, close: 106.5, volume: 1 },
    { time: 4, open: 106.5, high: 108, low: 105, close: 107.5, volume: 1 },
  ];
  const g = fairValueGaps(c);
  check("bullish fair-value gap between candle 1 high and candle 3 low", g.some((x) => x.kind === "bullish" && x.bottom === 101 && x.top === 103), JSON.stringify(g));
  const eng: Candle[] = [
    { time: 1, open: 105, high: 105.5, low: 103, close: 104, volume: 1 },
    { time: 2, open: 104, high: 104.2, low: 101.8, close: 102, volume: 1 },
    { time: 3, open: 101.8, high: 105, low: 101.5, close: 104.6, volume: 1 },
  ];
  check("bullish engulfing detected", candlePatterns(eng).some((x) => x.name === "Bullish engulfing"));
  const ham: Candle[] = [
    { time: 1, open: 106, high: 106.5, low: 104.5, close: 105, volume: 1 },
    { time: 2, open: 105, high: 105.2, low: 103.5, close: 104, volume: 1 },
    { time: 3, open: 103.6, high: 104.05, low: 100, close: 104, volume: 1 },
  ];
  check("hammer detected after a decline", candlePatterns(ham).some((x) => x.name === "Hammer"), candlePatterns(ham).map((x) => x.name).join(","));
}

/* agent assessment: long right under resistance is penalised; long off support in an uptrend is helped */
{
  const nearRes = mk([...wave.slice(0, -2), 107, 109.4], 0.3);
  const ctx = levelContext(nearRes)!;
  const a = levelAssessment(ctx, "long");
  check("long just under resistance is penalised", a.scoreAdj < 0, `${a.scoreAdj} · ${a.reasons.join(" | ")}`);
  check("stop below support, target before resistance", a.stop != null && a.stop < (ctx.support?.low ?? 0) && a.target != null && a.target < (ctx.resistance?.low ?? Infinity), `stop ${a.stop?.toFixed(2)} target ${a.target?.toFixed(2)}`);
  const nearSup = mk([...wave.slice(0, -2), 103, 100.6], 0.3);
  const b = levelAssessment(levelContext(nearSup)!, "long");
  check("long near support has more room than near resistance", b.scoreAdj > a.scoreAdj, `${b.scoreAdj} vs ${a.scoreAdj}`);
}

(async () => {
  // Live data: every tool runs on real stocks without errors or nonsense levels.
  for (const s of ["HCLTECH.NS", "RELIANCE.NS", "^NSEI"]) {
    try {
      const { candles } = await fetchChart(s, "1y", "1d");
      const ctx = levelContext(candles);
      const price = candles.at(-1)!.close;
      const ok = ctx != null && (ctx.support == null || ctx.support.mid < price * 1.01) && (ctx.resistance == null || ctx.resistance.mid > price * 0.99);
      check(`live ${s}: levels around the price`, ok, ctx ? ctx.notes.slice(0, 4).join(" | ") : "none");
    } catch (e) {
      console.log(`SKIP  live ${s}: ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
  process.exit(failed ? 1 : 0);
})();
