import "server-only";
import { SHORT_PAGE } from "../exchange/catalog";
import { buildForecast } from "../forecast";
import type { DataSnapshot } from "./data";
import { CALIBRATION_META } from "./specialists";
import { THRESHOLDS as T } from "./thresholds";
import type {
  AgentId,
  AgentResult,
  Bias,
  Conflict,
  Decision,
  ExpectedValue,
  Horizon,
  RiskReview,
  ScoreBreakdown,
  TradePlan,
  Validation,
  ValidatorReport,
} from "./types";

/* ------------------------------------- Scoring (spec §6) ------------------------------------- */

/** Initial research weights from the spec; NOT proven optimal — calibrate on out-of-sample results. */
export const WEIGHTS: Record<Horizon, Record<AgentId, number>> = {
  swing: { fundamental: 20, technical: 25, market: 15, news: 10, ownership: 10, quant: 10, fno: 10 },
  intraday: { fundamental: 5, technical: 35, market: 20, news: 10, ownership: 10, quant: 10, fno: 10 },
  "long-term": { fundamental: 45, technical: 10, market: 10, news: 10, ownership: 10, quant: 15, fno: 0 },
};

export function bandOf(score: number | null): string {
  if (score == null) return "Not scored";
  if (score >= 85) return "High-priority research candidate";
  if (score >= T.score.approve) return "Strong candidate requiring risk approval";
  if (score >= T.score.watchlist) return "Watchlist or conditional opportunity";
  if (score >= T.score.weak) return "Weak or conflicting setup";
  return "Reject or no trade";
}

/**
 * Weighted score over the agents that could actually score. For a bearish setup the agents'
 * bullishness is inverted (100 − score), so the total measures support for the PROPOSED direction.
 */
export function scoreAll(agents: AgentResult[], horizon: Horizon, direction: Bias): ScoreBreakdown {
  const weights = WEIGHTS[horizon];
  let sum = 0;
  let used = 0;
  let total = 0;
  const components = agents.map((a) => {
    const w = weights[a.agent] ?? 0;
    total += w;
    const s = a.score == null ? null : direction === "bearish" ? 100 - a.score : a.score;
    if (s != null && w > 0) {
      sum += s * w;
      used += w;
    }
    return { agent: a.agent, weight: w, score: s };
  });
  const score = used ? Math.round(sum / used) : null;
  return { total: score, band: bandOf(score), weights, components, coverage: total ? used / total : 0 };
}

/* -------------------------------- Conflict detection (stage 4) -------------------------------- */

export function detectConflicts(agents: AgentResult[], horizon: Horizon): Conflict[] {
  const by = Object.fromEntries(agents.map((a) => [a.agent, a])) as Record<AgentId, AgentResult>;
  const pairs: Array<[AgentId, AgentId]> = [
    ["technical", "market"],
    ["technical", "fundamental"],
    ["technical", "news"],
    ["technical", "quant"],
    ["fundamental", "market"],
  ];
  const out: Conflict[] = [];
  for (const [a, b] of pairs) {
    const x = by[a]?.bias;
    const y = by[b]?.bias;
    if (!x || !y || x === "neutral" || y === "neutral" || x === y) continue;
    const material =
      (a === "technical" && b === "market" && horizon === "intraday") ||
      (a === "technical" && b === "fundamental" && horizon === "long-term") ||
      (a === "technical" && b === "quant");
    out.push({
      between: [a, b],
      severity: material ? "material" : "minor",
      description: `${a} is ${x} but ${b} is ${y}.`,
    });
  }
  return out;
}

/* ------------------------------- Expected value (stage 5, §7) ------------------------------- */

type Cal = { n: number; hitRate: number; expectancy: number; payoffRatio: number } | null;

export function expectedValue(cal: Cal, horizon: Horizon): ExpectedValue {
  const costsPct = horizon === "intraday" ? INTRADAY_COST : CALIBRATION_META.costRoundTrip;
  if (!cal) {
    return {
      probabilityType: "unknown", pWin: null, avgWinPct: null, avgLossPct: null, expectancyPct: null, costsPct, samples: 0, period: null,
      note: "No validated probability for this setup and horizon. Expected value cannot be estimated, and AI-guessed probabilities are not used.",
    };
  }
  // expectancy E = p·W − (1−p)·L and payoff R = W/L  ⇒  L = E / (p·R − (1−p)), W = R·L
  const p = cal.hitRate;
  const denom = p * cal.payoffRatio - (1 - p);
  const avgLoss = Math.abs(denom) > 1e-6 ? cal.expectancy / denom : null;
  const avgWin = avgLoss != null ? cal.payoffRatio * avgLoss : null;
  return {
    probabilityType: "backtested",
    pWin: p,
    avgWinPct: avgWin != null && avgWin > 0 ? avgWin : null,
    avgLossPct: avgLoss != null && avgLoss > 0 ? avgLoss : null,
    expectancyPct: cal.expectancy,
    costsPct,
    samples: cal.n,
    period: CALIBRATION_META.period,
    note: `EV = P(win) × avg win − P(loss) × avg loss − costs, from ${cal.n.toLocaleString("en-IN")} out-of-sample signals. A positive EV would still not rule out a loss.`,
  };
}

/* ------------------------------- Proposed direction per horizon ------------------------------- */

/**
 * Intraday and swing: the technical setup proposes the direction.
 * Long term: the FUNDAMENTAL thesis proposes it (spec: short-term indicators must not be the primary
 * reason for a long-term investment); a bearish long-term technical trend vetoes a bullish thesis.
 */
export function proposedDirection(horizon: Horizon, technical: AgentResult | undefined, fundamental: AgentResult | undefined): Bias {
  const t = technical?.bias ?? "neutral";
  if (horizon !== "long-term") return t;
  const f = fundamental?.bias ?? "neutral";
  if (f === "bullish" && t === "bearish") return "neutral"; // strong business in a downtrend: conflict → wait
  if (f === "bullish") return "bullish";
  if (f === "bearish") return "bearish";
  return t === "bearish" ? "bearish" : "neutral";
}

/* ----------------------------------- Risk agent (stage 6) ----------------------------------- */

/** Approx. round-trip cost of an intraday equity trade (brokerage, STT on sell, exchange/SEBI fees, GST, stamp). */
const INTRADAY_COST = 0.001;
const ILLUSTRATIVE_CAPITAL = T.risk.illustrativeCapital;
const ILLUSTRATIVE_RISK = T.risk.illustrativeRiskPct;

export function riskAgent(d: DataSnapshot, direction: Bias, capitalIn: number | null, riskPctIn: number | null, marketOpen: boolean): RiskReview {
  const illustrative = !capitalIn || !riskPctIn;
  const capital = capitalIn && capitalIn > 0 ? capitalIn : ILLUSTRATIVE_CAPITAL;
  const riskPct = riskPctIn && riskPctIn > 0 ? Math.min(riskPctIn, T.risk.maxRiskPct) : ILLUSTRATIVE_RISK;
  const checks: RiskReview["checks"] = [];
  const scan = d.horizon === "intraday" ? d.intraday : d.horizon === "swing" ? d.swing : d.longTerm;
  const p = scan?.pick;

  if (illustrative) checks.push({ name: "Risk configuration", status: "warn", detail: `No capital / risk limit supplied — sizing is an illustration with ₹${ILLUSTRATIVE_CAPITAL.toLocaleString("en-IN")} at ${ILLUSTRATIVE_RISK}% risk.` });
  if (riskPctIn && riskPctIn > 5) checks.push({ name: "Risk per trade", status: "warn", detail: "Risk per trade capped at 5% of capital." });

  // Long-term thesis without a technical setup: accumulate with a fundamental-style invalidation level.
  const longTermThesis = d.horizon === "long-term" && direction === "bullish" && (!p || p.stop == null || p.bias !== "bullish");
  if (!p || direction === "neutral" || (p.stop == null && !longTermThesis) || (p.action === "WAIT" && !longTermThesis)) {
    checks.push({ name: "Trade definition", status: "fail", detail: "No directional setup with a defined stop — nothing to size." });
    return { approved: false, capital, riskPerTradePct: riskPct, illustrative, checks, plan: null };
  }

  const long = direction === "bullish";
  if (!long && d.horizon !== "intraday") {
    checks.push({
      name: "Short selling",
      status: "fail",
      detail: "Holding a cash-equity short overnight is not permitted in India; a bearish view here means exit/avoid if held. A short would need futures (F&O data not connected).",
    });
    return { approved: false, capital, riskPerTradePct: riskPct, illustrative, checks, plan: null };
  }

  const entry = d.live?.price ?? p.entry;
  // Long-term invalidation: 3% under the 200-day average, but never more than 15% below entry.
  const stop = longTermThesis || p.stop == null ? Math.max((d.ind?.sma200 ?? 0) * 0.97, entry * (1 - T.risk.longTermMaxStopPct / 100)) : p.stop;
  const dist = Math.abs(entry - stop);
  const t1 = !longTermThesis && p.target != null ? p.target : long ? entry + 2 * dist : entry - 2 * dist;
  const t2 = long ? entry + 1.5 * Math.abs(t1 - entry) : entry - 1.5 * Math.abs(t1 - entry);
  const rr = dist > 0 ? Math.abs(t1 - entry) / dist : null;
  const costRate = d.horizon === "intraday" ? INTRADAY_COST : CALIBRATION_META.costRoundTrip;

  let qty = dist > 0 ? Math.floor((capital * riskPct) / 100 / dist) : 0;
  if (qty * entry > capital) qty = Math.floor(capital / entry);
  const capitalRequired = qty * entry;
  const costs = capitalRequired * costRate;
  const maxLoss = qty * dist + costs;

  checks.push(
    rr == null
      ? { name: "Reward : risk", status: "fail", detail: "Stop equals entry." }
      : { name: "Reward : risk", status: rr >= T.risk.minRewardRisk ? "pass" : rr >= T.risk.warnRewardRisk ? "warn" : "fail", detail: `${rr.toFixed(2)} : 1 to target 1 (minimum ${T.risk.minRewardRisk} : 1).` },
  );
  checks.push(qty >= 1 ? { name: "Position size", status: "pass", detail: `${qty} shares; max loss ≈ ₹${Math.round(maxLoss).toLocaleString("en-IN")} incl. costs (${riskPct}% risk budget).` } : { name: "Position size", status: "fail", detail: "Capital too small for even one share at this risk budget." });

  const atr = d.ind?.atr ?? null;
  if (atr && d.horizon !== "intraday") {
    const m = dist / atr;
    checks.push({ name: "Stop placement", status: m >= T.risk.stopAtrMin && m <= T.risk.stopAtrMax ? "pass" : "warn", detail: `Stop is ${m.toFixed(1)}× daily ATR from entry (sensible range ${T.risk.stopAtrMin}–${T.risk.stopAtrMax}×).` });
  }
  const vol20 = d.daily.slice(-21, -1).map((c) => c.volume);
  const adv = vol20.length ? (vol20.reduce((a, b) => a + b, 0) / vol20.length) * entry : 0;
  const advCr = adv / 1e7;
  checks.push({ name: "Liquidity", status: advCr >= T.risk.liquidityPassCr ? "pass" : advCr >= T.risk.liquidityWarnCr ? "warn" : "fail", detail: `Average daily traded value ≈ ₹${advCr.toFixed(0)} crore.` });
  if (d.ind?.realizedVol != null && d.ind.realizedVol > T.risk.highVolatilityPct) checks.push({ name: "Volatility risk", status: "warn", detail: `Realised volatility ${d.ind.realizedVol.toFixed(0)}% annualised.` });
  if (d.vix != null && d.vix >= T.market.vixHigh) checks.push({ name: "Event / market risk", status: "warn", detail: `India VIX ${d.vix.toFixed(1)} — elevated market volatility.` });
  // NSE exchange data: surveillance, trading restrictions, circuits, F&O ban, events. A risk signal
  // that blocks this horizon fails the check (veto); other risk signals are warnings.
  const ex = d.exchangeData;
  for (const sig of ex?.signals.filter((x) => x.effect === "risk") ?? []) {
    checks.push({ name: `Exchange: ${sig.label}`, status: sig.blocks?.includes(d.horizon) ? "fail" : "warn", detail: `${sig.value} — ${sig.detail} (${SHORT_PAGE[sig.source]})` });
  }
  if (!ex?.events) checks.push({ name: "Event calendar", status: "warn", detail: "Results / dividend dates unavailable — check for scheduled events before acting." });
  else if (!ex.signals.some((x) => x.id === "results" && x.effect === "risk")) checks.push({ name: "Event calendar", status: "pass", detail: `No results inside the trade window${ex.events.earningsDate ? ` (next: ${ex.events.earningsDate})` : ""}.` });
  if (!ex?.stock) checks.push({ name: "Exchange checks", status: "warn", detail: ex?.note ?? "NSE surveillance / price-band data unavailable — restrictions could not be checked." });
  if (d.horizon === "intraday" && !marketOpen) checks.push({ name: "Session", status: "warn", detail: "Market is closed: this is a next-session watchlist with a conditional trigger, not an executable order." });
  if (d.horizon !== "intraday") checks.push({ name: "Gap risk", status: "warn", detail: "Overnight gaps can jump past the stop; actual loss can exceed the estimate." });

  const zone = dist * 0.15;
  const plan: TradePlan = {
    instrument: d.symbol,
    direction: long ? "long" : "short",
    entryLow: long ? entry - zone : entry,
    entryHigh: long ? entry : entry + zone,
    trigger: d.horizon === "intraday"
      ? `${long ? "Above" : "Below"} ${entry.toFixed(2)} with price ${long ? "holding above" : "below"} VWAP${marketOpen ? "" : " in the next session"}`
      : long ? `Buy within the entry zone while the daily close stays above ${stop.toFixed(2)}` : `Sell within the entry zone while price stays below ${stop.toFixed(2)}`,
    stop,
    targets: [t1, t2],
    riskReward: rr,
    quantity: qty,
    capitalRequired,
    maxLoss,
    estimatedCosts: costs,
    holdingPeriod: d.horizon === "intraday" ? "Same session — square off before 3:20 PM" : d.horizon === "swing" ? "Up to 10 trading days" : "3–12 months; review on each quarterly result",
    invalidation: `${long ? "Close below" : "Close above"} ${stop.toFixed(2)}, or a material negative disclosure.`,
    illustrativeSizing: illustrative,
  };
  const approved = !checks.some((c) => c.status === "fail");
  return { approved, capital, riskPerTradePct: riskPct, illustrative, checks, plan };
}

/* ----------------------------- Independent validator (stage 7) ----------------------------- */

export function validate(params: {
  dataOk: boolean;
  dataWarnings: string[];
  horizon: Horizon;
  direction: Bias;
  technical: AgentResult;
  fundamental: AgentResult;
  market: AgentResult;
  news: AgentResult;
  conflicts: Conflict[];
  ev: ExpectedValue;
  provenEvidence: boolean | null;
  risk: RiskReview;
  score: ScoreBreakdown;
}): ValidatorReport {
  const { dataOk, horizon, fundamental, market, news, conflicts, ev, provenEvidence, risk, score } = params;
  const dir = params.direction;
  const checks: ValidatorReport["checks"] = [];
  const conditions: string[] = [];

  checks.push({ name: "Market data current and verified", status: dataOk ? (params.dataWarnings.length ? "warn" : "pass") : "fail", detail: dataOk ? (params.dataWarnings[0] ?? "Fresh candles and quote.") : "Data failed validation." });
  checks.push({ name: "Direction supported", status: dir && dir !== "neutral" ? "pass" : "fail", detail: dir && dir !== "neutral" ? (horizon === "long-term" ? `Long-term thesis is ${dir} (fundamentals lead; technical trend not opposing).` : `Technical engine is ${dir}.`) : "No directional setup." });
  const material = conflicts.filter((c) => c.severity === "material");
  checks.push({ name: "No material conflicts", status: material.length ? "fail" : conflicts.length ? "warn" : "pass", detail: conflicts.length ? conflicts.map((c) => c.description).join(" ") : "Agents do not contradict each other." });
  if (horizon === "long-term") {
    const s = fundamental.score;
    checks.push({ name: "Fundamentals support a long-term hold", status: s == null ? "warn" : s >= T.fundamentals.longTermMin ? "pass" : s < T.fundamentals.bearish ? "fail" : "warn", detail: s == null ? "No fundamentals." : `Fundamental score ${s}.` });
  } else if (horizon === "swing") {
    const flags = fundamental.warnings.filter((w) => w.startsWith("Red flag")).length;
    checks.push({ name: "No serious fundamental red flags", status: flags >= 2 ? "warn" : "pass", detail: flags ? `${flags} red flag(s).` : "None detected." });
  } else checks.push({ name: "Fundamentals", status: "n/a", detail: "Low relevance intraday." });
  const newsOpp = news.bias && dir && news.bias !== "neutral" && dir !== "neutral" && news.bias !== dir;
  checks.push({ name: "News does not contradict", status: newsOpp ? "warn" : "pass", detail: newsOpp ? "Recent headlines lean the other way." : news.summary });
  const marketOpp = market.bias && dir && market.bias !== "neutral" && dir !== "neutral" && market.bias !== dir;
  checks.push({ name: "Market regime supports direction", status: marketOpp ? "warn" : "pass", detail: market.summary });
  checks.push({ name: "F&O liquidity / payoff", status: "n/a", detail: "Equity trade; NSE F&O data (build-up, PCR, OI levels) is used as evidence only — no options strategy is proposed." });
  checks.push({
    name: "Profitable after costs",
    status: ev.probabilityType === "unknown" ? "warn" : (ev.expectancyPct ?? 0) > 0 ? "pass" : "fail",
    detail: ev.probabilityType === "unknown" ? "Unknown — no validated probability." : `Backtested expectancy ${((ev.expectancyPct ?? 0) * 100).toFixed(2)}% per trade after costs.`,
  });
  checks.push({
    name: "Historical evidence sufficient",
    status: provenEvidence == null ? "warn" : provenEvidence ? "pass" : "fail",
    detail: provenEvidence == null ? "No out-of-sample test for this horizon yet." : provenEvidence ? "Beat the average stock after costs out of sample." : "Did not beat the average stock after costs out of sample.",
  });
  checks.push({ name: "Risk approval and position sizing", status: risk.approved ? "pass" : "fail", detail: risk.approved ? "Risk agent approved." : risk.checks.filter((c) => c.status === "fail").map((c) => c.detail).join(" ") || "Rejected." });
  checks.push({ name: "Score threshold", status: (score.total ?? 0) >= T.score.approve ? "pass" : (score.total ?? 0) >= T.score.watchlist ? "warn" : "fail", detail: `${score.total ?? "—"}/100 — ${score.band} (coverage ${(score.coverage * 100).toFixed(0)}%).` });

  let verdict: Validation;
  const failed = (n: string) => checks.find((c) => c.name === n)?.status === "fail";
  const warned = (n: string) => checks.find((c) => c.name === n)?.status === "warn";
  if (!dataOk) verdict = "INSUFFICIENT DATA";
  else if (failed("Direction supported")) verdict = "NO TRADE";
  else if (risk.checks.some((c) => c.name === "Short selling" && c.status === "fail") && !risk.checks.some((c) => c.name !== "Short selling" && c.status === "fail")) {
    // A bearish swing/long-term view is valid research, but cash shorts cannot be carried overnight.
    verdict = "NO TRADE";
    conditions.push("Bearish view: avoid new positions. If you already hold it, review your exit. A short would need futures (F&O data not connected).");
  } else if (failed("Risk approval and position sizing")) verdict = "REJECTED";
  else if (failed("Profitable after costs") || failed("Historical evidence sufficient") || failed("No material conflicts") || failed("Score threshold") || failed("Fundamentals support a long-term hold")) verdict = "NO TRADE";
  else if (warned("Profitable after costs") || warned("Historical evidence sufficient") || warned("Score threshold") || checks.some((c) => c.status === "warn")) {
    verdict = "APPROVED WITH CONDITIONS";
    if (warned("Profitable after costs") || warned("Historical evidence sufficient")) conditions.push("Probability of profit is not validated for this horizon — paper-trade or use minimal size until the rule set is backtested.");
    if (warned("Score threshold")) conditions.push("Score is in the watchlist band — wait for confirmation of the trigger.");
    if (risk.illustrative) conditions.push("Set your own capital and risk per trade; the sizing shown is an illustration.");
  } else verdict = "APPROVED";

  return { verdict, checks, conditions, llmConcerns: [], llmDowngraded: false };
}

/* ----------------------------------- Final decision (stage 8) ----------------------------------- */

export function finalDecision(verdict: Validation, horizon: Horizon, dir: Bias | null): Decision {
  if (verdict === "APPROVED") return dir === "bearish" ? "SELL" : "BUY";
  if (verdict === "APPROVED WITH CONDITIONS") return "WATCHLIST";
  return horizon === "long-term" ? "NO INVESTMENT" : "NO TRADE";
}

export function headlineFor(decision: Decision, verdict: Validation, symbol: string, dir: Bias | null = null, horizon: Horizon | null = null): string {
  if ((decision === "NO TRADE" || decision === "NO INVESTMENT") && dir === "bearish" && horizon !== "intraday" && verdict === "NO TRADE") {
    return `AVOID — bearish ${horizon ?? ""} view on ${symbol}: no new position; if you hold it, review your exit.`;
  }
  if (decision === "NO TRADE" || decision === "NO INVESTMENT") {
    if (verdict === "INSUFFICIENT DATA") return `INSUFFICIENT DATA — ${symbol} could not be verified well enough to analyse.`;
    return `${decision} – NO SUITABLE RISK-ADJUSTED OPPORTUNITY IDENTIFIED.`;
  }
  if (decision === "WATCHLIST") return `WATCHLIST — ${symbol} has a setup, but its probability is not validated; conditional only.`;
  return `${decision} — validated setup in ${symbol}; follow the stop and position size.`;
}

/* ------------------------------------------ Scenarios ------------------------------------------ */

export function scenarios(d: DataSnapshot): { bull: string; base: string; bear: string } {
  if (!d.ind || d.daily.length < 30) return { bull: "—", base: "—", bear: "—" };
  const h = d.horizon === "intraday" ? 1 : d.horizon === "swing" ? 10 : 60;
  const fc = buildForecast(d.daily.slice(-300), d.ind, h);
  const s = d.insight?.support[0];
  const r = d.insight?.resistance[0];
  const f = (x: number) => x.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  return {
    bull: `A close above ${r ? f(r) : "recent resistance"} with rising volume and a supportive market could extend toward the top of the expected range (${f(fc.bandHigh)} over ${h} session${h > 1 ? "s" : ""}).`,
    base: `Price stays inside the 80% expected range of ${f(fc.bandLow)}–${f(fc.bandHigh)} over ${h} session${h > 1 ? "s" : ""}${s && r ? `, oscillating between support ${f(s)} and resistance ${f(r)}` : ""}.`,
    bear: `A break below ${s ? f(s) : "recent support"}, a weak market or negative disclosure could push toward ${f(fc.bandLow)} or lower (1 in 10 outcomes falls below the range).`,
  };
}
