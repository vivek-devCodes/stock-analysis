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
  exchange: {
    // NSE/BSE exchange data (delivery, OI, deals, surveillance). See src/lib/exchange/interpret.ts.
    deliveryHighRatio: 1.3, // delivery % ≥ 1.3 × its recent average = unusual delivery (conviction)
    deliveryLowRatio: 0.7, // ≤ 0.7 × average with a big move = speculative / intraday-driven move
    deliveryHighAbs: 60, // without history, ≥ 60% delivery counts as high
    volumeSpike: 2, // volume ≥ 2 × recent average = volume spike
    pcrBullish: 1.2, // put–call OI ratio ≥ 1.2: put writers defending (supportive)
    pcrBearish: 0.7, // ≤ 0.7: call writers capping (pressure)
    pcrStretched: 1.8, // ≥ 1.8: crowded — supportive but stretched
    oiLevelPct: 1.5, // within 1.5% of the biggest call/put OI strike = at the options wall
    near52wkPct: 2, // within 2% of the 52-week high/low
    highAnnualVol: 0.6, // NSE Clearing annualised volatility ≥ 60% = high risk
    ivRichRatio: 1.4, // ATM implied vol ≥ 1.4 × realised = options pricing a big move (event)
    earningsSwingDays: 14, // results within 14 days = event risk for a swing trade
    tightBandPct: 5, // price band ≤ 5% blocks intraday (stock can freeze at its circuit)
    breadthStrong: 1.5, // advances ÷ declines ≥ 1.5 = broad rally
    breadthWeak: 0.67, // ≤ 0.67 = broad sell-off
    fiiLongBullish: 0.6, // FII index-futures long share ≥ 60% = positioned long
    fiiLongBearish: 0.3, // ≤ 30% = positioned short
  },
  plan: {
    // Next-session intraday plan (built after the close) and its execution at the open.
    candidates: 12, // stocks screened into the shortlist before exchange-data re-ranking
    analysed: 6, // stocks that get the full multi-agent analysis each night
    maxChasePct: 0.5, // skip at the open if price already covered ≥ 50% of the way to target
    expireDays: 4, // a plan not executed within 4 calendar days is expired
    orbMinutes: 15, // opening range = the first 15 minutes (09:15–09:30)
    orbDeadline: 11 * 60, // planned trades that have not broken out of the range by 11:00 IST are dropped
  },
  guard: {
    // Portfolio risk rules applied before every new paper entry (src/lib/paper/risk.ts).
    dailyLossPct: 2, // stop opening trades for the day once closed losses reach 2% of capital
    maxOpen: 5, // at most 5 open intraday positions
    maxPerSector: 2, // at most 2 positions in one sector
    maxPositionPct: 25, // one position never uses more than 25% of capital
    atrCapPct: 3, // a stock moving more than 3% a day (ATR) gets proportionally fewer shares
    drawdownPausePct: 8, // pause new recommended trades after an 8% drawdown (shadow trades continue)
    breakEvenR: 1, // move the stop to entry once the trade is 1 × risk in profit
  },
  regime: {
    // Market regime from India VIX and the NIFTY 50 trend (src/lib/paper/regime.ts).
    vixCaution: 18, // VIX ≥ 18: half size, at most 3 new trades
    vixSkip: 25, // VIX ≥ 25: no new recommended trades
    vixJumpPct: 10, // VIX up ≥ 10% in a session: treat as caution
    trendDays: 20, // NIFTY vs its 20-day average decides the trend
    chopBandPct: 0.75, // NIFTY within ±0.75% of its 20-day average = no trend (choppy)
  },
  learn: {
    // Scorecard and adaptive weights (src/lib/learn/).
    minSignalObs: 100, // a signal needs 100 scored observations before it is judged
    muteBelow: 0.5, // hit rate below 50% (no better than a coin flip) → the signal is muted in ranking
    minAgentCalls: 30, // an agent needs 30 directional calls on closed trades before its weight adapts
    minTradesToAdapt: 60, // and the horizon needs 60 closed paper trades overall
    weightFloor: 0.5, // adaptive weight stays between 0.5× and 1.5× the research weight
    weightCeil: 1.5,
    liquidCr: 10, // signals are scored on stocks trading ≥ ₹10 crore a day
    baselinePicks: 5, // baselines: 5 stocks each
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
      group: "Exchange data (NSE / BSE files)",
      rules: [
        "Vetoes: GSM surveillance (all horizons); trade-to-trade series BE/BZ, a price band of " + t.exchange.tightBandPct + "% or tighter, a circuit hit the previous session, or results due today/next session (intraday).",
        `Accumulation = delivery % ≥ ${t.exchange.deliveryHighRatio}× its ${10}-session average on an up day; distribution = the same on a down day.`,
        `Futures build-up from the F&O bhavcopy: price × OI change. PCR ≥ ${t.exchange.pcrBullish} supportive, ≤ ${t.exchange.pcrBearish} pressure; within ${t.exchange.oiLevelPct}% of the biggest call/put OI strike = at the options wall.`,
        `Market: advances ÷ declines ≥ ${t.exchange.breadthStrong} broad rally, ≤ ${t.exchange.breadthWeak} broad sell-off; FII index futures ≥ ${t.exchange.fiiLongBullish * 100}% long bullish, ≤ ${t.exchange.fiiLongBearish * 100}% bearish.`,
        "All exchange data is end of day (the previous session's official files); live prices come from NSE's live server.",
      ],
    },
    {
      group: "Paper trading: regime, risk rules and entries",
      rules: [
        `Regime: India VIX ≥ ${t.regime.vixSkip} → no new recommended trades; VIX ≥ ${t.regime.vixCaution} (or up ≥ ${t.regime.vixJumpPct}% in a session) or a choppy NIFTY (within ±${t.regime.chopBandPct}% of its ${t.regime.trendDays}-day average) → half size, at most 3 positions. In a clear NIFTY trend only the with-trend side is traded.`,
        `Stop opening trades after a ${t.guard.dailyLossPct}% daily loss; at most ${t.guard.maxOpen} open positions, ${t.guard.maxPerSector} per sector, ${t.guard.maxPositionPct}% of capital per position; stocks moving more than ${t.guard.atrCapPct}% a day get proportionally fewer shares.`,
        `Recommended trades pause after a ${t.guard.drawdownPausePct}% drawdown until resumed on the Scorecard page. Blocked trades are still paper-traded as shadow, so each rule's value is measured.`,
        `Planned trades enter on a break of the first ${t.plan.orbMinutes} minutes' range in their direction (until ${Math.floor(t.plan.orbDeadline / 60)}:00); the stop moves to entry once a candle closes ${t.guard.breakEvenR}× risk in profit; everything is squared off at 15:15.`,
      ],
    },
    {
      group: "Learning loop (Scorecard)",
      rules: [
        `Every night each NSE signal is scored on liquid stocks (≥ ₹${t.learn.liquidCr} crore/day) against the next session's open → close move.`,
        `After ${t.learn.minSignalObs} observations a signal right less than ${t.learn.muteBelow * 100}% of the time is muted in plan ranking; better ones get up to ${t.learn.weightCeil}× weight.`,
        `After ${t.learn.minTradesToAdapt} closed paper trades, each agent with ≥ ${t.learn.minAgentCalls} calls has its score weight scaled ${t.learn.weightFloor}–${t.learn.weightCeil}× by its hit rate (set ADAPTIVE_WEIGHTS=off to disable).`,
        `The agent's plan is compared daily with yesterday's top ${t.learn.baselinePicks} gainers and ${t.learn.baselinePicks} random picks from the same screen, all open → close after costs.`,
      ],
    },
    {
      group: "Horizon logic",
      rules: [
        "Intraday & swing: the technical setup proposes the direction (VWAP, opening range, EMAs for intraday; trend filter + pullback/bounce for swing).",
        `Long term: fundamentals propose the direction (score ≥ ${t.fundamentals.bullish}); a bearish long-term trend vetoes it; a long-term hold needs fundamentals ≥ ${t.fundamentals.longTermMin}.`,
        `Score weights — swing: fundamental 20, technical 25, market 15, news 10, ownership 10, quant 10, F&O 10; intraday: technical 35, market 20, ownership 10, F&O 10; long term: fundamental 45. Initial research weights, not proven optimal.`,
      ],
    },
  ];
}
