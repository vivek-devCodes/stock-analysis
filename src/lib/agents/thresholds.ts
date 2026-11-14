// Every threshold the agent engine applies, in one place. The decision code imports these values,
// and the AI Analyst page and the digest email print them — so what you read is what was applied.
// Safe to import on client and server.

export const THRESHOLDS = {
  score: {
    approve: 75, // ≥ 75: strong candidate (still needs risk + validator approval)
    watchlist: 65, // 65–74: watchlist / conditional
    weak: 50, // 50–64: weak or conflicting; < 50: reject
  },
  risk: {
    minRewardRisk: 1.5, // target 1 must be ≥ 1.5 × the distance to the stop
    warnRewardRisk: 1, // 1–1.5 is a warning, below 1 fails
    illustrativeCapital: 100_000, // used only when you don't enter capital
    illustrativeRiskPct: 1, // % of capital risked per trade when not configured
    maxRiskPct: 5, // risk per trade is capped here even if you enter more
    stopAtrMin: 0.5, // stop should be 0.5–4 × daily ATR from entry
    stopAtrMax: 4,
    liquidityPassCr: 10, // average daily traded value (₹ crore) to pass
    liquidityWarnCr: 2, // below this the liquidity check fails
    highVolatilityPct: 60, // realised volatility (annualised) that triggers a warning
    longTermMaxStopPct: 15, // long-term invalidation never more than 15% below entry
  },
  market: {
    vixHigh: 20, // India VIX ≥ 20 = high volatility (risk warning)
    vixLow: 13,
    rupeeWeakPct: 1.5, // USD/INR up > 1.5% in 20 sessions = risk-off signal
    crudeSpikePct: 10, // Brent up > 10% in 20 sessions = risk-off signal
    usSelloffPct: -5, // S&P 500 down > 5% in 20 sessions = risk-off signal
  },
  fundamentals: {
    bullish: 65, // fundamental score ≥ 65 = supportive
    bearish: 45, // < 45 = weak
    longTermMin: 55, // long-term hold needs ≥ 55 (fails below 45)
  },
  proven: {
    // A rule set counts as "proven" only if, on unseen (out-of-sample) data, after costs:
    minSignals: 200,
    minHitRate: 0.55,
    minProfitFactor: 1.1,
    // …and its expectancy is positive and it beat the average stock (edge > 0).
  },
  costs: {
    deliveryRoundTripPct: 0.3, // STT 0.1% each side + brokerage, exchange/SEBI fees, GST, stamp duty, slippage
    intradayRoundTripPct: 0.1,
  },
  scan: {
    candidatesPerHorizon: 5, // shortlist size per horizon before the full agent pipeline runs
  },
  riskProfile: {
    // Per-stock risk level: HIGH if any "high" limit is crossed, MEDIUM if any "medium" limit is.
    volHigh: 0.4, // annualised volatility ≥ 40% = high
    volMedium: 0.25,
    drawdownHigh: -0.2, // worst 3-month fall ≤ −20% = high
    drawdownMedium: -0.1,
    betaHigh: 1.3, // moves ≥ 1.3× the market = high
    betaMedium: 1.0,
    illiquidCr: 2, // < ₹2 crore/day traded = high (hard to exit)
    stopAtr: 2, // suggested stop = 2 × daily ATR below price
  },
  sector: {
    buyingRatio: 1.2, // up-day volume ≥ 1.2 × down-day volume over 20 sessions = buying pressure
    sellingRatio: 0.83, // ≤ 0.83 (≈ 1 ÷ 1.2) = selling pressure
  },
} as const;

/** Plain-English rule list for the UI and the digest email. */
export function describeRules(): Array<{ group: string; rules: string[] }> {
  const t = THRESHOLDS;
  return [
    {
      group: "Final decision",
      rules: [
        `APPROVED needs a score ≥ ${t.score.approve}, risk approval, no material conflicts, and a PROVEN positive expectancy after costs.`,
        `APPROVED WITH CONDITIONS (shown as WATCHLIST): everything passes except the probability is unproven or the score is ${t.score.watchlist}–${t.score.approve - 1}.`,
        `NO TRADE / NO INVESTMENT when there is no directional setup, the score is below ${t.score.watchlist}, the backtest shows negative expectancy, or agents conflict materially.`,
        "A language model may only DOWNGRADE a verdict. It never computes numbers or probabilities.",
      ],
    },
    {
      group: "Profitability (is it profitable?)",
      rules: [
        `"Proven" = on unseen data after costs: ≥ ${t.proven.minSignals} signals, hit rate ≥ ${t.proven.minHitRate * 100}%, profit factor ≥ ${t.proven.minProfitFactor}, positive expectancy, and better than the average stock.`,
        "Expected value = P(win) × average win − P(loss) × average loss − costs, using backtested probabilities only. If none exist, it is reported as UNKNOWN.",
        `Costs assumed: ${t.costs.deliveryRoundTripPct}% round trip for delivery, ${t.costs.intradayRoundTripPct}% for intraday.`,
      ],
    },
    {
      group: "Risk agent (can veto)",
      rules: [
        `Reward : risk to target 1 must be ≥ ${t.risk.minRewardRisk} : 1.`,
        `Position size = capital × risk% ÷ stop distance (default ₹${t.risk.illustrativeCapital.toLocaleString("en-IN")} at ${t.risk.illustrativeRiskPct}% when not configured; risk capped at ${t.risk.maxRiskPct}%).`,
        `Stop between ${t.risk.stopAtrMin}× and ${t.risk.stopAtrMax}× daily ATR; liquidity ≥ ₹${t.risk.liquidityPassCr} crore/day (fails below ₹${t.risk.liquidityWarnCr} crore).`,
        `Warnings for realised volatility > ${t.risk.highVolatilityPct}%, India VIX ≥ ${t.market.vixHigh}, overnight gap risk and unknown results dates.`,
        "No overnight cash-equity shorts (not permitted in India): a bearish swing/long-term view means avoid / review exit.",
      ],
    },
    {
      group: "Horizon logic",
      rules: [
        "Intraday & swing: the technical setup proposes the direction (VWAP, opening range, EMAs for intraday; trend filter + pullback/bounce for swing).",
        `Long term: fundamentals propose the direction (score ≥ ${t.fundamentals.bullish}); a bearish long-term trend vetoes it; a long-term hold needs fundamentals ≥ ${t.fundamentals.longTermMin}.`,
        `Score weights — swing: fundamental 20, technical 25, market 15, news 15, ownership 10, quant 15; intraday: technical 40, market 25; long term: fundamental 45. Initial research weights, not proven optimal.`,
      ],
    },
  ];
}
