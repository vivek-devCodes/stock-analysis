// Pure calculations behind the per-stock "agent view & risk" panel. No network access here,
// so these are easy to test. Definitions follow the glossary (Ch. 11 risk, Ch. 20 statistics).

import { THRESHOLDS } from "../agents/thresholds";
import { computeIndicators } from "../indicators";
import type { Candle, Insight } from "../types";
import type { QuickVerdict, Returns, RiskLevel, RiskProfile } from "./types";

const R = THRESHOLDS.riskProfile;
const F = THRESHOLDS.fundamentals;

const istDay = (unix: number) => Math.floor((unix + 19800) / 86400);

function dailyReturns(c: Candle[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < c.length; i += 1) if (c[i - 1].close > 0) out.push(c[i].close / c[i - 1].close - 1);
  return out;
}

function std(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

/** Simple returns over 1 day and ~1/2/3 months (21/42/63 sessions). */
export function returnsOf(c: Candle[]): Returns {
  const back = (n: number) => (c.length > n && c[c.length - 1 - n].close > 0 ? c.at(-1)!.close / c[c.length - 1 - n].close - 1 : null);
  return { d1: back(1), m1: back(21), m2: back(42), m3: back(63) };
}

/** Worst peak-to-trough fall over the window (≤ 0). */
export function maxDrawdown(c: Candle[]): number | null {
  if (c.length < 2) return null;
  let peak = c[0].close;
  let worst = 0;
  for (const x of c) {
    peak = Math.max(peak, x.close);
    worst = Math.min(worst, x.close / peak - 1);
  }
  return worst;
}

/** Beta = cov(stock, market) ÷ var(market), on daily returns matched by trading day. */
export function betaVs(stock: Candle[], market: Candle[]): number | null {
  const m = new Map<number, number>();
  for (let i = 1; i < market.length; i += 1) m.set(istDay(market[i].time), market[i].close / market[i - 1].close - 1);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 1; i < stock.length; i += 1) {
    const mr = m.get(istDay(stock[i].time));
    if (mr == null || stock[i - 1].close <= 0) continue;
    xs.push(mr);
    ys.push(stock[i].close / stock[i - 1].close - 1);
  }
  if (xs.length < 60) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let cov = 0;
  let varx = 0;
  for (let i = 0; i < xs.length; i += 1) {
    cov += (xs[i] - mx) * (ys[i] - my);
    varx += (xs[i] - mx) ** 2;
  }
  return varx ? cov / varx : null;
}

/**
 * Historical 1-day VaR at 95%: the 5th-percentile daily return (a loss, so negative), using the
 * nearest-rank method — rank ⌈0.05 × n⌉, i.e. the 5th-worst day out of 100.
 */
export function var95(c: Candle[]): number | null {
  const r = dailyReturns(c.slice(-251)).sort((a, b) => a - b);
  if (r.length < 60) return null;
  return r[Math.ceil(r.length * 0.05) - 1];
}

export function riskProfile(daily: Candle[], nifty: Candle[], priceIn?: number | null): RiskProfile {
  const price = priceIn ?? daily.at(-1)?.close ?? null;
  const vol = std(dailyReturns(daily.slice(-127)));
  const volatilityAnnual = vol == null ? null : vol * Math.sqrt(252);
  const maxDrawdown3m = maxDrawdown(daily.slice(-64));
  const beta = betaVs(daily.slice(-251), nifty);
  const v95 = var95(daily);
  const ind = daily.length >= 30 ? computeIndicators(daily.slice(-300)) : null;
  const atr = ind?.atr ?? null;
  const last20 = daily.slice(-20);
  const avgDailyValueCr = last20.length ? last20.reduce((a, c) => a + c.volume * c.close, 0) / last20.length / 1e7 : null;

  const stopDist = atr ? R.stopAtr * atr : null;
  const suggestedStop = price != null && stopDist ? price - stopDist : null;
  const capital = THRESHOLDS.risk.illustrativeCapital;
  let qty = price && stopDist ? Math.floor((capital * THRESHOLDS.risk.illustrativeRiskPct) / 100 / stopDist) : null;
  if (qty != null && price && qty * price > capital) qty = Math.floor(capital / price);
  const maxLossAtStop = qty != null && stopDist ? qty * stopDist : null;

  const high: string[] = [];
  const medium: string[] = [];
  if (volatilityAnnual != null) {
    if (volatilityAnnual >= R.volHigh) high.push(`High volatility (${(volatilityAnnual * 100).toFixed(0)}% a year)`);
    else if (volatilityAnnual >= R.volMedium) medium.push(`Moderate volatility (${(volatilityAnnual * 100).toFixed(0)}% a year)`);
  }
  if (maxDrawdown3m != null) {
    if (maxDrawdown3m <= R.drawdownHigh) high.push(`Fell ${(Math.abs(maxDrawdown3m) * 100).toFixed(0)}% from its peak in 3 months`);
    else if (maxDrawdown3m <= R.drawdownMedium) medium.push(`Drawdown of ${(Math.abs(maxDrawdown3m) * 100).toFixed(0)}% in 3 months`);
  }
  if (beta != null) {
    if (beta >= R.betaHigh) high.push(`Moves ${beta.toFixed(1)}× the market (high beta)`);
    else if (beta >= R.betaMedium) medium.push(`Moves about ${beta.toFixed(1)}× the market`);
  }
  if (avgDailyValueCr != null && avgDailyValueCr < R.illiquidCr) high.push(`Thinly traded (₹${avgDailyValueCr.toFixed(1)} crore/day)`);
  const level: RiskLevel = high.length ? "HIGH" : medium.length ? "MEDIUM" : "LOW";
  const reasons = level === "LOW" ? ["Volatility, drawdown, beta and liquidity are all within low-risk limits."] : [...high, ...medium];

  return {
    level,
    reasons,
    volatilityAnnual,
    maxDrawdown3m,
    beta,
    var95OneDay: v95,
    atrPct: ind?.atrPercent != null ? ind.atrPercent / 100 : null,
    avgDailyValueCr,
    suggestedStop,
    illustrativeQty: qty,
    maxLossAtStop,
  };
}

/**
 * A quick screening stance from the same engines the agents use. It is NOT a validated
 * recommendation: the swing rules are unproven and long-term rules untested, and that is stated.
 */
export function quickVerdict(params: {
  daily: Candle[];
  insight: Insight | null;
  fundamentalScore: number | null;
  flags: string[];
  risk: RiskProfile;
}): QuickVerdict {
  const { daily, insight, fundamentalScore: fs, flags, risk } = params;
  const ind = daily.length >= 210 ? computeIndicators(daily.slice(-300)) : null;
  const price = daily.at(-1)?.close ?? 0;
  const trend: QuickVerdict["trend"] = !ind || ind.sma50 == null || ind.sma200 == null
    ? "unknown"
    : price > ind.sma200 && ind.sma50 > ind.sma200 ? "up" : price < ind.sma200 && ind.sma50 < ind.sma200 ? "down" : "mixed";
  const swing = insight?.recommendation ?? "HOLD";
  const strong = fs != null && fs >= F.bullish;
  const weak = fs != null && fs < F.bearish;
  const severeFlag = flags.some((f) => /negative net worth|loss-making/i.test(f));
  const reasons: string[] = [];
  reasons.push(`Trend: ${trend === "up" ? "long-term uptrend (above 200-day average)" : trend === "down" ? "long-term downtrend (below 200-day average)" : trend === "mixed" ? "mixed — averages disagree" : "not enough history"}.`);
  if (fs != null) reasons.push(`Fundamentals ${fs}/100 (${strong ? "strong" : weak ? "weak" : "average"})${flags.length ? `; red flags: ${flags.join(", ")}` : ""}.`);
  if (swing !== "HOLD") reasons.push(`Swing engine: ${swing === "BUY" ? "buy-the-dip setup" : "sell-the-rally setup"} (rule set unproven).`);
  reasons.push(`Risk level ${risk.level}.`);

  let stance: QuickVerdict["stance"] = "NEUTRAL";
  let horizonHint: QuickVerdict["horizonHint"] = null;
  if (severeFlag || (trend === "down" && (weak || swing === "SELL")) || (risk.level === "HIGH" && trend === "down")) {
    stance = "AVOID";
  } else if (strong && trend === "up" && risk.level !== "HIGH") {
    stance = "CONSIDER";
    horizonHint = "long-term";
  } else if (swing === "BUY" && !weak && risk.level !== "HIGH") {
    stance = "CONSIDER";
    horizonHint = "swing";
  } else if (strong || swing === "BUY") {
    stance = "WATCH";
    horizonHint = strong ? "long-term" : "swing";
  }

  const summary =
    stance === "CONSIDER"
      ? `Worth a closer look for ${horizonHint === "long-term" ? "a long-term position" : "a swing trade"} — run the full agent analysis to validate it and size the risk.`
      : stance === "WATCH"
        ? "Some positives, but trend, fundamentals or risk do not all line up yet — keep on watch."
        : stance === "AVOID"
          ? "Avoid new positions for now: weak trend combined with weak fundamentals, a bearish setup or high risk."
          : "No clear edge either way right now.";

  return {
    stance,
    horizonHint,
    summary,
    reasons,
    evidence: horizonHint === "swing" ? "unproven" : "untested",
    fundamentalScore: fs,
    trend,
  };
}
