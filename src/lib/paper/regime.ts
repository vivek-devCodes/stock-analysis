// Market regime: should the agent trade today, how big, and in which direction?
// From India VIX (NSE indices file) and the NIFTY 50 trend vs its 20-day average.
// Pure; safe on client and server; covered by src/scripts/test-learn.ts.

import { THRESHOLDS } from "../agents/thresholds";

const R = THRESHOLDS.regime;

export type RegimeTrend = "up" | "down" | "choppy" | "unknown";

export type Regime = {
  /** Trading date of the data the regime was read from. */
  asOf: string | null;
  vix: number | null;
  vixChangePct: number | null;
  nifty: number | null;
  niftyVsAvgPct: number | null;
  trend: RegimeTrend;
  /** calm = normal size; caution = half size, fewer trades; stand-aside = no new recommended trades. */
  level: "calm" | "caution" | "stand-aside";
  sizeMult: number;
  /** Most open recommended positions allowed in this regime. */
  maxNewTrades: number;
  /** Sides the agent may take as recommended trades (the other side is still paper-traded as shadow). */
  allowLong: boolean;
  allowShort: boolean;
  notes: string[];
};

export function assessRegime(input: { asOf: string | null; vix: number | null; vixChangePct: number | null; niftyCloses: number[] }): Regime {
  const notes: string[] = [];
  const closes = input.niftyCloses.filter((x) => Number.isFinite(x) && x > 0);
  const nifty = closes.at(-1) ?? null;
  let trend: RegimeTrend = "unknown";
  let vsAvg: number | null = null;
  if (closes.length >= R.trendDays && nifty != null) {
    const window = closes.slice(-R.trendDays);
    const avg = window.reduce((a, b) => a + b, 0) / window.length;
    const prevAvg = closes.length > R.trendDays ? closes.slice(-R.trendDays - 1, -1).reduce((a, b) => a + b, 0) / R.trendDays : avg;
    vsAvg = ((nifty - avg) / avg) * 100;
    if (Math.abs(vsAvg) < R.chopBandPct) trend = "choppy";
    else if (vsAvg > 0 && avg >= prevAvg) trend = "up";
    else if (vsAvg < 0 && avg <= prevAvg) trend = "down";
    else trend = "choppy";
    notes.push(`NIFTY ${nifty.toFixed(0)} is ${vsAvg >= 0 ? "+" : ""}${vsAvg.toFixed(2)}% vs its ${R.trendDays}-day average → ${trend === "up" ? "uptrend" : trend === "down" ? "downtrend" : "no clear trend"}`);
  } else notes.push("NIFTY trend unavailable");

  let level: Regime["level"] = "calm";
  const { vix, vixChangePct } = input;
  if (vix != null) {
    if (vix >= R.vixSkip) {
      level = "stand-aside";
      notes.push(`India VIX ${vix.toFixed(1)} ≥ ${R.vixSkip}: extreme volatility — no new recommended trades`);
    } else if (vix >= R.vixCaution || (vixChangePct ?? 0) >= R.vixJumpPct) {
      level = "caution";
      notes.push(vix >= R.vixCaution ? `India VIX ${vix.toFixed(1)} ≥ ${R.vixCaution}: half size` : `India VIX jumped ${vixChangePct!.toFixed(1)}%: half size`);
    } else notes.push(`India VIX ${vix.toFixed(1)}: calm`);
  } else notes.push("India VIX unavailable");
  if (trend === "choppy" && level === "calm") {
    level = "caution";
    notes.push("Choppy market: fewer trades");
  }

  return {
    asOf: input.asOf,
    vix,
    vixChangePct,
    nifty,
    niftyVsAvgPct: vsAvg,
    trend,
    level,
    sizeMult: level === "calm" ? 1 : level === "caution" ? 0.5 : 0,
    maxNewTrades: level === "calm" ? THRESHOLDS.guard.maxOpen : level === "caution" ? 3 : 0,
    // Trade with the index trend: in a clear trend, the counter-trend side is shadow-only.
    allowLong: level !== "stand-aside" && trend !== "down",
    allowShort: level !== "stand-aside" && trend !== "up",
    notes,
  };
}
