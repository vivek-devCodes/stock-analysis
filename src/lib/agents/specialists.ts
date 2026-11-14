import "server-only";
import calibration from "../calibration.json";
import { computeIndicators } from "../indicators";
import type { Candle } from "../types";
import type { DataSnapshot } from "./data";
import { THRESHOLDS as T } from "./thresholds";
import type { AgentResult, Bias, Finding, NewsItemRef } from "./types";

/**
 * The specialist agents (spec §3, agents 2–8). Each is a deterministic function of the data
 * snapshot: numbers come from tested code, never from a language model. An agent that lacks the
 * data it needs returns status "insufficient-data" and says what is missing.
 */

const pct = (x: number | null | undefined, d = 1) => (x == null || !Number.isFinite(x) ? "—" : `${x >= 0 ? "+" : ""}${x.toFixed(d)}%`);
const num = (x: number | null | undefined, d = 2) => (x == null || !Number.isFinite(x) ? "—" : x.toLocaleString("en-IN", { maximumFractionDigits: d }));
const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const biasOf = (score: number | null): Bias | null => (score == null ? null : score >= 60 ? "bullish" : score <= 40 ? "bearish" : "neutral");
const tone = (x: number | null | undefined): Finding["tone"] => (x == null ? undefined : x >= 0 ? "up" : "down");

function changePct(c: Candle[], bars: number): number | null {
  if (c.length <= bars) return null;
  const a = c.at(-1 - bars)!.close;
  return a ? ((c.at(-1)!.close - a) / a) * 100 : null;
}

function emaLast(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i += 1) e = values[i] * k + e * (1 - k);
  return e;
}

const regimeOf = (price: number, sma50: number | null, sma200: number | null) =>
  sma50 == null || sma200 == null ? "unclear" : price > sma200 && sma50 > sma200 ? "bullish" : price < sma200 && sma50 < sma200 ? "bearish" : "sideways";

/* -------------------------------- Agent 2: Market intelligence -------------------------------- */

export function marketAgent(d: DataSnapshot): AgentResult & { regimeLabel: string } {
  if (d.nifty.length < 210) {
    return {
      agent: "market", status: "insufficient-data", score: null, bias: null, regimeLabel: "Unknown",
      summary: "NIFTY 50 history unavailable, so the market regime could not be determined.",
      findings: [], evidence: [], warnings: [], sources: [],
    };
  }
  const ind = computeIndicators(d.nifty);
  const price = d.nifty.at(-1)!.close;
  const regime = regimeOf(price, ind.sma50, ind.sma200);
  const nifty20 = changePct(d.nifty, 20);
  const vixState = d.vix == null ? null : d.vix >= T.market.vixHigh ? "high" : d.vix <= T.market.vixLow ? "low" : "normal";
  const sector20 = d.sectorIndex ? changePct(d.sectorIndex.candles, 20) : null;
  const rel = sector20 != null && nifty20 != null ? sector20 - nifty20 : null;
  const inr = d.macro.find((m) => m.symbol === "INR=X");
  const crude = d.macro.find((m) => m.symbol === "BZ=F");
  const us = d.macro.find((m) => m.symbol === "^GSPC");
  const usFut = d.macro.find((m) => m.symbol === "ES=F");
  const riskOffSignals = [
    vixState === "high" && "India VIX elevated",
    inr?.change20dPct != null && inr.change20dPct > T.market.rupeeWeakPct && "rupee weakening",
    crude?.change20dPct != null && crude.change20dPct > T.market.crudeSpikePct && "crude up sharply",
    us?.change20dPct != null && us.change20dPct < T.market.usSelloffPct && "US equities falling",
  ].filter(Boolean) as string[];
  const riskMode = riskOffSignals.length >= 2 ? "risk-off" : riskOffSignals.length === 0 ? "risk-on" : "mixed";

  let score = regime === "bullish" ? 70 : regime === "bearish" ? 30 : 50;
  if (vixState === "high") score -= 10;
  if (riskMode === "risk-off") score -= 5;
  if (rel != null) score += rel > 2 ? 5 : rel < -2 ? -5 : 0;
  score = clamp(Math.round(score));
  const trendStrength = ind.adx == null ? "" : ind.adx >= 25 ? "trending" : ind.adx < 20 ? "range-bound" : "moderate trend";
  const regimeLabel = `${regime === "bullish" ? "Bullish" : regime === "bearish" ? "Bearish" : regime === "sideways" ? "Sideways" : "Unclear"}${trendStrength ? ` (${trendStrength})` : ""} · ${vixState ?? "unknown"} volatility · ${riskMode}`;

  return {
    agent: "market",
    status: "ok",
    score,
    bias: biasOf(score),
    regimeLabel,
    summary: `NIFTY 50 is in a ${regime} regime (${pct(nifty20)} over 20 sessions)${vixState ? ` with ${vixState} volatility (India VIX ${num(d.vix, 1)})` : ""}; global backdrop ${riskMode}.${rel != null ? ` ${d.sector} is ${rel >= 0 ? "outperforming" : "underperforming"} the market by ${Math.abs(rel).toFixed(1)} pts.` : ""}`,
    findings: [
      { label: "NIFTY regime", value: regime },
      { label: "NIFTY 20D", value: pct(nifty20), tone: tone(nifty20) },
      { label: "ADX (NIFTY)", value: num(ind.adx, 0) },
      { label: "India VIX", value: num(d.vix, 1), tone: vixState === "high" ? "warn" : undefined },
      ...(sector20 != null ? [{ label: `${d.sector} index 20D`, value: pct(sector20), tone: tone(sector20) } as Finding] : []),
      ...(inr ? [{ label: "USD/INR 20D", value: pct(inr.change20dPct), tone: inr.change20dPct != null && inr.change20dPct > T.market.rupeeWeakPct ? "warn" : undefined } as Finding] : []),
      ...(crude ? [{ label: "Brent 20D", value: pct(crude.change20dPct) } as Finding] : []),
      ...(usFut ? [{ label: "US futures 20D", value: pct(usFut.change20dPct), tone: tone(usFut.change20dPct) } as Finding] : []),
    ],
    evidence: [
      `NIFTY ${price > (ind.sma200 ?? Infinity) ? "above" : "below"} its 200-day average (${num(ind.sma200, 0)}).`,
      ...(riskOffSignals.length ? [`Risk-off signals: ${riskOffSignals.join(", ")}.`] : ["No major risk-off signals in VIX, rupee, crude or US equities."]),
    ],
    warnings: [
      "Not yet connected: FII/DII flows, market breadth (advance/decline), GIFT NIFTY, RBI/economic calendar.",
    ],
    sources: [],
  };
}

/* -------------------------------- Agent 4: Technical analysis -------------------------------- */

export function technicalAgent(d: DataSnapshot): AgentResult {
  const scan = d.horizon === "intraday" ? d.intraday : d.horizon === "swing" ? d.swing : d.longTerm;
  if (!d.ind || !scan) {
    return {
      agent: "technical", status: "insufficient-data", score: null, bias: null,
      summary: "Not enough candle data to run the technical engine for this horizon.",
      findings: [], evidence: [], warnings: [], sources: [],
    };
  }
  const p = scan.pick;
  const ind = d.ind;
  const closes = d.daily.slice(-300).map((c) => c.close);
  const price = d.live?.price ?? closes.at(-1)!;
  const ema = { e9: emaLast(closes, 9), e20: emaLast(closes, 20), e50: emaLast(closes, 50), e200: emaLast(closes, 200) };
  const wk = d.weekly.length >= 60 ? computeIndicators(d.weekly) : null;
  const weeklyTrend = wk ? (price > (wk.sma50 ?? Infinity) && (wk.sma20 ?? 0) > (wk.sma50 ?? Infinity) ? "up" : price < (wk.sma50 ?? -Infinity) && (wk.sma20 ?? Infinity) < (wk.sma50 ?? -Infinity) ? "down" : "mixed") : "unknown";
  const dailyTrend = regimeOf(price, ind.sma50, ind.sma200);
  const aligned =
    (p.bias === "bullish" && weeklyTrend === "up" && dailyTrend === "bullish") || (p.bias === "bearish" && weeklyTrend === "down" && dailyTrend === "bearish");
  const score = clamp(Math.round(50 + p.score / 2));
  const bias: Bias = p.bias;

  const findings: Finding[] = [
    { label: "Daily trend", value: dailyTrend },
    { label: "Weekly trend", value: weeklyTrend },
    { label: "RSI", value: num(ind.rsi, 0), tone: ind.rsi != null && (ind.rsi >= 70 || ind.rsi <= 30) ? "warn" : undefined },
    { label: "ADX", value: num(ind.adx, 0) },
    { label: "ATR %", value: ind.atrPercent != null ? `${ind.atrPercent.toFixed(2)}%` : "—" },
    { label: "Vol ratio", value: ind.volumeRatio != null ? `${ind.volumeRatio.toFixed(1)}×` : "—" },
    { label: "vs EMA 20 / 50 / 200", value: [ema.e20, ema.e50, ema.e200].map((e) => (e == null ? "—" : price >= e ? "above" : "below")).join(" / ") },
    ...p.metrics.map((m) => ({ label: m.label, value: m.value, tone: m.tone })),
  ];
  if (d.insight?.support[0]) findings.push({ label: "Support", value: num(d.insight.support[0]) });
  if (d.insight?.resistance[0]) findings.push({ label: "Resistance", value: num(d.insight.resistance[0]) });

  return {
    agent: "technical",
    status: "ok",
    score,
    bias,
    summary: `${p.action === "WAIT" ? "No clear setup" : `${p.action} setup`} on the ${d.horizon} timeframe (engine score ${p.score > 0 ? "+" : ""}${p.score}). Daily trend ${dailyTrend}, weekly ${weeklyTrend}${aligned ? " — timeframes aligned" : ""}.`,
    findings,
    evidence: [...p.reasons, ...(d.insight && d.horizon !== "intraday" ? d.insight.working.slice(0, 1) : [])],
    warnings: [
      ...(aligned || p.bias === "neutral" ? [] : ["Timeframes are not aligned (daily vs weekly vs setup)."]),
      "Not yet computed: Supertrend, Ichimoku, OBV, MFI, CMF, delivery %, candlestick/chart patterns.",
    ],
    sources: [],
  };
}

/* ------------------------------- Agent 3: Fundamental analysis ------------------------------- */

export function fundamentalAgent(d: DataSnapshot): AgentResult {
  const f = d.fundamentals;
  if (!f) {
    return {
      agent: "fundamental", status: "insufficient-data", score: null, bias: null,
      summary: "Fundamentals could not be retrieved for this instrument (indices, ETFs and some stocks have none).",
      findings: [], evidence: [], warnings: [], sources: [],
    };
  }
  const s = f.scores;
  return {
    agent: "fundamental",
    status: "ok",
    score: s.overall,
    bias: s.overall >= T.fundamentals.bullish ? "bullish" : s.overall < T.fundamentals.bearish ? "bearish" : "neutral",
    summary: `Fundamental score ${s.overall}/100 (quality ${s.quality}, growth ${s.growth}, value ${s.value}).${f.flags.length ? ` Red flags: ${f.flags.join(", ")}.` : " No red flags detected in available data."}${d.horizon === "intraday" ? " Low relevance for an intraday trade." : ""}`,
    findings: [
      { label: "ROE", value: f.roe != null ? `${f.roe.toFixed(1)}%` : "—", tone: f.roe != null ? (f.roe >= 15 ? "up" : f.roe < 8 ? "down" : undefined) : undefined },
      { label: "Debt/Eq", value: num(f.debtToEquity) },
      { label: "P/E", value: num(f.pe, 1) },
      { label: "P/B", value: num(f.pb) },
      { label: "Revenue YoY (Q)", value: pct(f.revenueGrowth), tone: tone(f.revenueGrowth) },
      { label: "EPS YoY (Q)", value: pct(f.earningsGrowth), tone: tone(f.earningsGrowth) },
      { label: "Net margin", value: f.netMargin != null ? `${f.netMargin.toFixed(1)}%` : "—" },
      { label: "Operating cash flow", value: f.operatingCashFlowCr != null ? `₹${num(f.operatingCashFlowCr, 0)} cr` : "—", tone: f.operatingCashFlowCr != null && f.operatingCashFlowCr < 0 ? "down" : undefined },
      { label: "Free cash flow", value: f.freeCashFlowCr != null ? `₹${num(f.freeCashFlowCr, 0)} cr` : "—", tone: f.freeCashFlowCr != null && f.freeCashFlowCr < 0 ? "down" : undefined },
      { label: "Div yield", value: f.dividendYield != null ? `${f.dividendYield.toFixed(2)}%` : "—" },
    ],
    evidence: [`Quality ${s.quality}: ROE, leverage, margins. Growth ${s.growth}: latest-quarter YoY revenue and earnings. Value ${s.value}: P/E, P/B, dividend.`],
    warnings: [
      ...f.flags.map((fl) => `Red flag: ${fl}`),
      "Not available from the current data source: ROCE, full P&L/balance-sheet/cash-flow history, multi-year CAGR, peer comparison, DCF / intrinsic value.",
    ],
    sources: [],
  };
}

/* ------------------------------- Agent 6: News & sentiment ------------------------------- */

const normTitle = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function newsAgent(d: DataSnapshot): AgentResult & { items: NewsItemRef[] } {
  const now = Date.now();
  const seen = new Set<string>();
  const items: NewsItemRef[] = [];
  for (const a of d.articles) {
    const k = normTitle(a.title);
    if (seen.has(k)) continue;
    seen.add(k);
    items.push({ headline: a.title, source: a.source, url: a.link, publishedAt: a.publishedAt, sentiment: a.sentiment, sourceClass: "media-report", stale: !!a.publishedAt && now - Date.parse(a.publishedAt) > 72 * 3600_000 });
  }
  for (const n of d.yahooNews) {
    const k = normTitle(n.title);
    if (seen.has(k) || now - Date.parse(n.publishedAt) > 7 * 86400_000) continue;
    seen.add(k);
    items.push({ headline: n.title, source: `${n.publisher} (via Yahoo)`, url: n.link, publishedAt: n.publishedAt, sentiment: n.sentiment, sourceClass: "aggregator", stale: now - Date.parse(n.publishedAt) > 72 * 3600_000 });
  }
  items.sort((a, b) => (Date.parse(b.publishedAt ?? "") || 0) - (Date.parse(a.publishedAt ?? "") || 0));
  const fresh = items.filter((i) => !i.stale);
  const pos = fresh.filter((i) => i.sentiment === "positive").length;
  const neg = fresh.filter((i) => i.sentiment === "negative").length;
  const score = fresh.length ? clamp(Math.round(50 + ((pos - neg) / fresh.length) * 30), 20, 80) : null;

  return {
    agent: "news",
    status: "ok",
    score,
    bias: biasOf(score),
    items: items.slice(0, 12),
    summary: items.length
      ? `${items.length} relevant headline(s) in the last 7 days (${fresh.length} within 72 h): ${pos} positive, ${neg} negative by keyword sentiment.`
      : "No relevant headlines in the last 7 days.",
    findings: [
      { label: "Headlines (7d)", value: String(items.length) },
      { label: "Fresh (72h)", value: String(fresh.length) },
      { label: "Positive / negative", value: `${pos} / ${neg}` },
    ],
    evidence: fresh.slice(0, 3).map((i) => `${i.sentiment === "positive" ? "▲" : i.sentiment === "negative" ? "▼" : "•"} ${i.headline} — ${i.source}`),
    warnings: [
      "All headlines are media reports or aggregator items; exchange disclosures, results calendars and SEBI/RBI feeds are not connected yet.",
      "Sentiment is a keyword score, and a trade is never made on headlines alone.",
    ],
    sources: [],
  };
}

/* ------------------------------- Agent 7: Ownership & flows ------------------------------- */

export function ownershipAgent(d: DataSnapshot): AgentResult {
  const ins = d.fundamentals?.insiderHolding ?? null;
  return {
    agent: "ownership",
    status: "insufficient-data",
    score: null,
    bias: null,
    summary: "Institutional flow data is not connected, so ownership is not scored.",
    findings: ins != null ? [{ label: "Promoter / insider holding", value: `${ins.toFixed(1)}%` }] : [],
    evidence: [],
    warnings: ["Missing: FII/FPI, DII and mutual-fund holdings, promoter pledges, bulk/block deals, insider disclosures and quarter-on-quarter changes (needs exchange shareholding/deal filings)."],
    sources: [],
  };
}

/* ------------------------------- Agent 5: Futures & options ------------------------------- */

export function fnoAgent(): AgentResult {
  return {
    agent: "fno",
    status: "insufficient-data",
    score: null,
    bias: null,
    summary: "No option-chain or futures data feed is connected, so no derivatives strategy can be evaluated.",
    findings: [],
    evidence: [],
    warnings: [
      "Missing: futures price/basis, open interest and its change, PCR, max pain, implied volatility, Greeks, lot sizes and bid-ask spreads.",
      "Per the operating rules, no options strategy is recommended without its complete payoff and maximum risk, so F&O decisions are disabled.",
    ],
    sources: [],
  };
}

/* ----------------------------- Agent 8: Quantitative research ----------------------------- */

type Cal = { n: number; hitRate: number; expectancy: number; profitFactor: number; payoffRatio: number; edge: number; proven: boolean } | null;
const CAL = calibration as unknown as { horizonDays: number; period: string; costRoundTrip: number; buy: Cal; sell: Cal };

export function quantAgent(d: DataSnapshot): AgentResult & { cal: Cal; side: "BUY" | "SELL" | null } {
  const side = d.horizon === "swing" && d.insight && d.insight.recommendation !== "HOLD" ? d.insight.recommendation : null;
  const cal = side === "BUY" ? CAL.buy : side === "SELL" ? CAL.sell : null;
  if (d.horizon !== "swing") {
    return {
      agent: "quant", status: "ok", score: null, bias: null, cal: null, side: null,
      summary: `No validated out-of-sample backtest exists yet for ${d.horizon} rules, so the probability of profit is unknown.`,
      findings: [], evidence: [], warnings: ["Without a validated probability, a positive expected value cannot be claimed (no AI-guessed probabilities)."], sources: [],
    };
  }
  if (!side || !cal) {
    return {
      agent: "quant", status: "ok", score: null, bias: null, cal: null, side: null,
      summary: "The swing engine shows no setup today, so there is no signal to evaluate.",
      findings: [], evidence: [], warnings: [], sources: [],
    };
  }
  const score = cal.proven ? 75 : clamp(Math.round(50 + cal.edge * 1000), 15, 45);
  return {
    agent: "quant",
    status: "ok",
    score,
    bias: cal.proven ? (side === "BUY" ? "bullish" : "bearish") : "neutral",
    cal,
    side,
    summary: `${side} setups were right ${(cal.hitRate * 100).toFixed(0)}% of the time out of sample, averaging ${(cal.expectancy * 100).toFixed(2)}% per trade after costs (profit factor ${cal.profitFactor.toFixed(2)}). ${cal.proven ? "Proven." : "Unproven: did not beat the average stock after costs."}`,
    findings: [
      { label: "Hit rate", value: `${(cal.hitRate * 100).toFixed(1)}%` },
      { label: "Per trade, after costs", value: `${(cal.expectancy * 100).toFixed(2)}%`, tone: cal.expectancy > 0 ? "up" : "down" },
      { label: "Profit factor", value: cal.profitFactor.toFixed(2), tone: cal.profitFactor >= 1 ? "up" : "down" },
      { label: "vs average stock", value: `${(cal.edge * 100).toFixed(2)}%`, tone: cal.edge > 0 ? "up" : "down" },
      { label: "Signals tested", value: cal.n.toLocaleString("en-IN") },
    ],
    evidence: [`Walk-forward backtest, ${CAL.horizonDays}-day horizon, ${CAL.costRoundTrip * 100}% round-trip costs, test period ${CAL.period}.`],
    warnings: ["Universe = today's large caps (survivorship bias); overlapping samples; past results do not guarantee future results."],
    sources: [{ name: "Apex Desk walk-forward backtest (src/lib/calibration.json)", kind: "backtest", note: CAL.period }],
  };
}

export const CALIBRATION_META = { horizonDays: CAL.horizonDays, period: CAL.period, costRoundTrip: CAL.costRoundTrip };
