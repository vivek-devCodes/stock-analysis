import "server-only";
import { buildInsight } from "./analysis";
import { buildForecast } from "./forecast";
import { computeIndicators } from "./indicators";
import { MODE_INFO, type Mode, type ScreenPick, type ScreenResult } from "./modes";
import { getAllStocks, SECTORS } from "./stock-universe";
import type { Candle, Quote, TrackRecord } from "./types";
import { fetchChart } from "./yahoo";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const IST_OFFSET_S = 5.5 * 3600;
const istDay = (unixSeconds: number) => Math.floor((unixSeconds + IST_OFFSET_S) / 86400);

const SECTOR_OF = new Map<string, string>();
for (const [sector, list] of Object.entries(SECTORS)) {
  for (const s of list) if (!SECTOR_OF.has(s)) SECTOR_OF.set(s, sector);
}
const INDEX_NAMES: Record<string, string> = { "^NSEI": "Nifty 50", "^NSEBANK": "Bank Nifty" };

const pct = (a: number, b: number | undefined) => (b ? ((a - b) / b) * 100 : 0);
const signed = (v: number, digits = 2) => `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round2 = (n: number) => Math.round(n * 100) / 100;
const tone = (v: number) => (v >= 0 ? ("up" as const) : ("down" as const));

function mean(values: number[]) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function sma(closes: number[], period: number, offset = 0): number | null {
  const end = closes.length - offset;
  if (end < period) return null;
  return mean(closes.slice(end - period, end));
}

function base(symbol: string, quote: Quote) {
  return {
    symbol,
    name: INDEX_NAMES[symbol] ?? quote.name,
    sector: INDEX_NAMES[symbol] ? "Index" : (SECTOR_OF.get(symbol) ?? "Nifty 50"),
    price: round2(quote.price),
    changePercent: round2(quote.changePercent),
    entry: round2(quote.price),
  };
}

export type Scan = { pick: ScreenPick; time: number };

/** For desks whose rules have not been backtested yet. */
const untested = (horizonDays: number): TrackRecord => ({
  status: "untested",
  hitRate: null,
  expectancy: null,
  profitFactor: null,
  edge: null,
  samples: 0,
  horizonDays,
  period: null,
});

/** Daily-candle trend engine shared by short-term and options. */
function swingCore(quote: Quote, candles: Candle[]) {
  const ind = computeIndicators(candles);
  const fc = buildForecast(candles, ind, 10);
  const insight = buildInsight(quote, candles, ind, []);
  return { ind, fc, insight };
}

/* ------------------------------------------------------------------ */
/*  Intraday — 15-min candles, today's session                         */
/* ------------------------------------------------------------------ */

export async function scanIntraday(symbol: string): Promise<Scan | null> {
  const { quote, candles } = await fetchChart(symbol, "5d");
  if (candles.length < 30) return null;

  const lastTime = candles.at(-1)!.time;
  const today = istDay(lastTime);
  const session = candles.filter((c) => istDay(c.time) === today);
  const earlier = candles.filter((c) => istDay(c.time) < today);
  if (!session.length || !earlier.length) return null;

  const prevClose = earlier.at(-1)!.close;
  // Previous session reference levels (PDH / PDL / PDC) and the Central Pivot Range (CPR):
  // P = (H + L + C) / 3, BC = (H + L) / 2, TC = 2P - BC (TC/BC swapped so TC is the upper line).
  const prevDay = earlier.filter((c) => istDay(c.time) === istDay(earlier.at(-1)!.time));
  const pdh = Math.max(...prevDay.map((c) => c.high));
  const pdl = Math.min(...prevDay.map((c) => c.low));
  const pivot = (pdh + pdl + prevClose) / 3;
  const bc = (pdh + pdl) / 2;
  const tc = 2 * pivot - bc;
  const cprTop = Math.max(tc, bc);
  const cprBottom = Math.min(tc, bc);
  const price = quote.price || session.at(-1)!.close;
  const gap = pct(session[0].open, prevClose);
  const dayChange = pct(price, prevClose);

  // Session VWAP
  let pv = 0;
  let vol = 0;
  for (const c of session) {
    pv += ((c.high + c.low + c.close) / 3) * c.volume;
    vol += c.volume;
  }
  const vwap = vol > 0 ? pv / vol : null;

  // Relative volume: today's volume vs the same number of bars in earlier sessions
  const byDay = new Map<number, Candle[]>();
  for (const c of earlier) {
    const d = istDay(c.time);
    byDay.set(d, [...(byDay.get(d) ?? []), c]);
  }
  const priorVolumes = [...byDay.values()].map((bars) =>
    bars.slice(0, session.length).reduce((s, c) => s + c.volume, 0),
  );
  const avgPriorVol = mean(priorVolumes.filter((v) => v > 0));
  const relVol = avgPriorVol > 0 ? vol / avgPriorVol : null;

  // Opening range = first 30 minutes (two 15-min bars)
  const hasOR = session.length > 2;
  const orHigh = Math.max(...session.slice(0, 2).map((c) => c.high));
  const orLow = Math.min(...session.slice(0, 2).map((c) => c.low));

  const ind = computeIndicators(candles);
  const reasons: string[] = [];
  let score = 0;

  if (vwap) {
    if (price > vwap) {
      score += 20;
      reasons.push(`Trading above VWAP (${vwap.toFixed(2)})`);
    } else {
      score -= 20;
      reasons.push(`Trading below VWAP (${vwap.toFixed(2)})`);
    }
  }
  if (hasOR && price > orHigh) {
    score += 15;
    reasons.push(`Broke above the 30-min opening range high ${orHigh.toFixed(2)}`);
  } else if (hasOR && price < orLow) {
    score -= 15;
    reasons.push(`Broke below the 30-min opening range low ${orLow.toFixed(2)}`);
  }
  if (ind.ema12 && ind.ema26) {
    score += ind.ema12 > ind.ema26 ? 15 : -15;
    reasons.push(ind.ema12 > ind.ema26 ? "15-min EMA12 above EMA26 (momentum up)" : "15-min EMA12 below EMA26 (momentum down)");
  }
  if (ind.macdHistogram != null) score += ind.macdHistogram > 0 ? 10 : -10;
  if (ind.rsi != null) {
    if (ind.rsi >= 55 && ind.rsi < 72) score += 10;
    else if (ind.rsi > 28 && ind.rsi <= 45) score -= 10;
    else if (ind.rsi >= 72) reasons.push(`RSI ${ind.rsi.toFixed(0)} — overbought, avoid chasing`);
    else if (ind.rsi <= 28) reasons.push(`RSI ${ind.rsi.toFixed(0)} — oversold, avoid chasing shorts`);
  }
  score += dayChange > 0 ? 10 : dayChange < 0 ? -10 : 0;
  if (price > pdh) reasons.push(`Above previous day high ${pdh.toFixed(2)}`);
  else if (price < pdl) reasons.push(`Below previous day low ${pdl.toFixed(2)}`);
  if (price > cprTop) reasons.push(`Trading above the CPR (${cprBottom.toFixed(2)}–${cprTop.toFixed(2)})`);
  else if (price < cprBottom) reasons.push(`Trading below the CPR (${cprBottom.toFixed(2)}–${cprTop.toFixed(2)})`);
  if (Math.abs(gap) >= 1) reasons.push(`Gapped ${gap > 0 ? "up" : "down"} ${Math.abs(gap).toFixed(2)}% at open`);
  if (relVol != null) {
    if (relVol >= 1.5) {
      score *= 1.25;
      reasons.push(`Volume ${relVol.toFixed(1)}× normal for this time of day`);
    } else if (relVol < 0.7) {
      score *= 0.7;
      reasons.push(`Thin volume (${relVol.toFixed(1)}× normal) — weaker conviction`);
    }
  }
  score = Math.round(clamp(score, -100, 100));

  const bias = score >= 25 ? "bullish" : score <= -25 ? "bearish" : "neutral";
  const atr = ind.atr ?? price * 0.004;
  const pick: ScreenPick = {
    ...base(symbol, quote),
    changePercent: round2(dayChange),
    bias,
    action: bias === "bullish" ? "BUY" : bias === "bearish" ? "SELL" : "WAIT",
    score,
    target: bias === "neutral" ? null : round2(bias === "bullish" ? price + 3 * atr : price - 3 * atr),
    stop: bias === "neutral" ? null : round2(bias === "bullish" ? price - 1.5 * atr : price + 1.5 * atr),
    targetLabel: "Target (2R)",
    stopLabel: "Stop loss",
    metrics: [
      { label: "Gap", value: signed(gap), tone: tone(gap) },
      { label: "vs VWAP", value: vwap ? signed(pct(price, vwap)) : "—", tone: vwap ? tone(price - vwap) : undefined },
      { label: "Rel. vol", value: relVol != null ? `${relVol.toFixed(1)}×` : "—", tone: relVol != null && relVol >= 1.5 ? "warn" : undefined },
      { label: "RSI 15m", value: ind.rsi != null ? ind.rsi.toFixed(0) : "—" },
      { label: "ATR 15m", value: ind.atrPercent != null ? `${ind.atrPercent.toFixed(2)}%` : "—" },
      { label: "PDH / PDL", value: `${pdh.toFixed(1)} / ${pdl.toFixed(1)}` },
      { label: "CPR", value: `${cprBottom.toFixed(1)}–${cprTop.toFixed(1)}`, tone: price > cprTop ? "up" : price < cprBottom ? "down" : undefined },
    ],
    reasons: reasons.slice(0, 5),
    track: untested(0),
  };
  return { pick, time: lastTime };
}

/* ------------------------------------------------------------------ */
/*  Short term — daily candles, 1–2 week swing                         */
/* ------------------------------------------------------------------ */

export async function scanShortTerm(symbol: string): Promise<Scan | null> {
  const { quote, candles } = await fetchChart(symbol, "1y");
  if (candles.length < 60) return null;
  const { ind, fc, insight } = swingCore(quote, candles);
  const price = quote.price;
  const score = Math.round(clamp(insight.score, -100, 100));
  const bias = insight.recommendation === "BUY" ? "bullish" : insight.recommendation === "SELL" ? "bearish" : "neutral";
  const atr = ind.atr ?? price * 0.02;
  const ret20 = pct(price, candles.at(-21)?.close);

  let target: number | null = null;
  let stop: number | null = null;
  if (bias === "bullish") {
    stop = price - 1.5 * atr;
    const res = insight.resistance[0];
    target = res && res - price >= 1.5 * atr ? res : price + 3 * atr;
  } else if (bias === "bearish") {
    stop = price + 1.5 * atr;
    const sup = insight.support[0];
    target = sup && price - sup >= 1.5 * atr ? sup : price - 3 * atr;
  }

  const reasons =
    bias === "bullish"
      ? insight.working
      : bias === "bearish"
        ? insight.notWorking
        : [...insight.working.slice(0, 1), ...insight.notWorking.slice(0, 1)];

  const pick: ScreenPick = {
    ...base(symbol, quote),
    bias,
    action: bias === "bullish" ? "BUY" : bias === "bearish" ? "SELL" : "WAIT",
    score,
    target: target != null ? round2(target) : null,
    stop: stop != null ? round2(stop) : null,
    targetLabel: "Target (1–2 wk)",
    stopLabel: "Stop loss",
    metrics: [
      { label: "10D range (80%)", value: `${fc.bandLow.toFixed(0)}–${fc.bandHigh.toFixed(0)}` },
      { label: "20D return", value: signed(ret20), tone: tone(ret20) },
      { label: "RSI", value: ind.rsi != null ? ind.rsi.toFixed(0) : "—" },
      { label: "ATR", value: ind.atrPercent != null ? `${ind.atrPercent.toFixed(2)}%` : "—" },
      { label: "ADX", value: ind.adx != null ? ind.adx.toFixed(0) : "—" },
    ],
    reasons: [...reasons.slice(0, 3), ...insight.risks.slice(0, 1)],
    track: insight.track,
  };
  return { pick, time: candles.at(-1)!.time };
}

/* ------------------------------------------------------------------ */
/*  Long term — daily candles, 2 years                                 */
/* ------------------------------------------------------------------ */

export async function scanLongTerm(symbol: string): Promise<Scan | null> {
  const { quote, candles } = await fetchChart(symbol, "2y");
  if (candles.length < 210) return null;
  const closes = candles.map((c) => c.close);
  const price = quote.price;
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const sma200Prev = sma(closes, 200, 20);
  const ret3m = pct(price, closes.at(-64));
  const ret6m = pct(price, closes.at(-127));
  const ret1y = closes.length > 253 ? pct(price, closes.at(-253)) : null;
  const high52 = Math.max(...candles.slice(-252).map((c) => c.high));
  const offHigh = pct(price, high52);
  const ind = computeIndicators(candles);

  const reasons: string[] = [];
  let score = 0;
  if (sma200) {
    if (price > sma200) {
      score += 25;
      reasons.push(`Above the 200-day average (${sma200.toFixed(2)}) — long-term uptrend`);
    } else {
      score -= 25;
      reasons.push(`Below the 200-day average (${sma200.toFixed(2)}) — long-term downtrend`);
    }
  }
  if (sma50 && sma200) {
    score += sma50 > sma200 ? 15 : -15;
    reasons.push(sma50 > sma200 ? "50-day above 200-day (golden-cross regime)" : "50-day below 200-day (death-cross regime)");
  }
  if (sma200 && sma200Prev) score += sma200 > sma200Prev ? 10 : -10;
  score += clamp(ret6m, -30, 30) * 0.5;
  if (ret1y != null) score += clamp(ret1y, -40, 40) * 0.25;
  if (offHigh > -10) {
    score += 10;
    reasons.push(`Within ${Math.abs(offHigh).toFixed(1)}% of its 52-week high`);
  } else if (offHigh < -30) {
    score -= 10;
    reasons.push(`${Math.abs(offHigh).toFixed(0)}% below its 52-week high`);
  }
  if (ind.realizedVol != null && ind.realizedVol > 40) {
    score -= 10;
    reasons.push(`High volatility (${ind.realizedVol.toFixed(0)}% annualised)`);
  }
  score = Math.round(clamp(score, -100, 100));

  const bias = score >= 30 ? "bullish" : score <= -30 ? "bearish" : "neutral";
  let stop: number | null = null;
  let target: number | null = null;
  let stopLabel = "Exit if it closes below";
  if (bias === "bullish") {
    stop = sma200 && price > sma200 ? Math.max(sma200 * 0.97, price * 0.85) : price * 0.88;
    target = price + 2 * (price - stop);
  } else if (bias === "bearish" && sma200) {
    stop = sma200;
    stopLabel = "Re-check above";
  }

  const pick: ScreenPick = {
    ...base(symbol, quote),
    bias,
    action: bias === "bullish" ? "ACCUMULATE" : bias === "bearish" ? "AVOID" : "WAIT",
    score,
    target: target != null ? round2(target) : null,
    stop: stop != null ? round2(stop) : null,
    targetLabel: "Target (2:1)",
    stopLabel,
    metrics: [
      { label: "3M", value: signed(ret3m, 1), tone: tone(ret3m) },
      { label: "6M", value: signed(ret6m, 1), tone: tone(ret6m) },
      { label: "1Y", value: ret1y != null ? signed(ret1y, 1) : "—", tone: ret1y != null ? tone(ret1y) : undefined },
      { label: "From 52W high", value: signed(offHigh, 1), tone: offHigh > -10 ? "up" : offHigh < -30 ? "down" : undefined },
      { label: "Volatility", value: ind.realizedVol != null ? `${ind.realizedVol.toFixed(0)}%` : "—" },
    ],
    reasons: reasons.slice(0, 4),
    track: untested(60),
  };
  return { pick, time: candles.at(-1)!.time };
}

/* ------------------------------------------------------------------ */
/*  Options — CALL / PUT direction on the underlying                   */
/* ------------------------------------------------------------------ */

/** Approximate NSE strike interval. Confirm on the live option chain. */
function strikeStep(symbol: string, price: number) {
  if (symbol === "^NSEI") return 50;
  if (symbol === "^NSEBANK") return 100;
  if (price < 100) return 1;
  if (price < 250) return 2.5;
  if (price < 500) return 5;
  if (price < 1000) return 10;
  if (price < 2500) return 20;
  if (price < 5000) return 50;
  return 100;
}

export async function scanOptions(symbol: string): Promise<Scan | null> {
  const { quote, candles } = await fetchChart(symbol, "1y");
  if (candles.length < 60) return null;
  const { ind, insight } = swingCore(quote, candles);
  const price = quote.price;
  const score = Math.round(clamp(insight.score, -100, 100));
  const hist = ind.macdHistogram ?? 0;
  // Direction comes from the same swing engine (trend filter + pullback/bounce timing).
  const bias = insight.recommendation === "BUY" ? "bullish" : insight.recommendation === "SELL" ? "bearish" : "neutral";
  const atr = ind.atr ?? price * 0.015;
  const step = strikeStep(symbol, price);
  const strike = Math.round(price / step) * step;
  const weekMove = ind.realizedVol != null ? price * (ind.realizedVol / 100) * Math.sqrt(5 / 252) : null;
  const expiry = symbol === "^NSEI" ? "Nearest weekly expiry" : "Current monthly expiry";

  const reasons =
    bias === "bullish"
      ? insight.working.slice(0, 3)
      : bias === "bearish"
        ? insight.notWorking.slice(0, 3)
        : [`Trend score ${score} with MACD ${hist > 0 ? "positive" : "negative"} — no clear edge for option buying`];

  const pick: ScreenPick = {
    ...base(symbol, quote),
    bias,
    action: bias === "bullish" ? "CALL" : bias === "bearish" ? "PUT" : "WAIT",
    score,
    target: bias === "neutral" ? null : round2(bias === "bullish" ? price + 1.5 * atr : price - 1.5 * atr),
    stop: bias === "neutral" ? null : round2(bias === "bullish" ? price - atr : price + atr),
    targetLabel: "Underlying target",
    stopLabel: "Underlying stop",
    metrics: [
      { label: "ATM strike", value: strike.toLocaleString("en-IN") },
      { label: "Strike step", value: String(step) },
      {
        label: "1-week move",
        value: weekMove != null ? `±${weekMove.toFixed(0)} (${((weekMove / price) * 100).toFixed(1)}%)` : "—",
      },
      { label: "RSI", value: ind.rsi != null ? ind.rsi.toFixed(0) : "—" },
      { label: "ATR", value: ind.atrPercent != null ? `${ind.atrPercent.toFixed(2)}%` : "—" },
    ],
    reasons,
    track: insight.track,
    option: bias === "neutral" ? undefined : { type: bias === "bullish" ? "CE" : "PE", strike, strikeStep: step, expiry },
  };
  return { pick, time: candles.at(-1)!.time };
}

/* ------------------------------------------------------------------ */
/*  Runner + cache                                                     */
/* ------------------------------------------------------------------ */

const SCANNERS: Record<Mode, (symbol: string) => Promise<Scan | null>> = {
  intraday: scanIntraday,
  "short-term": scanShortTerm,
  "long-term": scanLongTerm,
  options: scanOptions,
};

function universe(mode: Mode) {
  const stocks = getAllStocks();
  return mode === "options" ? ["^NSEI", "^NSEBANK", ...stocks] : stocks;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const out: Array<PromiseSettledResult<R>> = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = { status: "fulfilled", value: await fn(items[i]) };
      } catch (reason) {
        out[i] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function compute(mode: Mode): Promise<ScreenResult> {
  const symbols = universe(mode);
  const results = await mapLimit(symbols, 6, SCANNERS[mode]);
  const picks: ScreenPick[] = [];
  let failed = 0;
  let latest = 0;
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) {
      picks.push(r.value.pick);
      latest = Math.max(latest, r.value.time);
    } else {
      failed += 1;
    }
  }
  picks.sort((a, b) => b.score - a.score);

  const notes: string[] = [];
  if (mode === "intraday" && latest && istDay(latest) !== istDay(Date.now() / 1000)) {
    const day = new Date(latest * 1000).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
    notes.push(`Market is closed — showing the last session (${day}). Use these to plan the next session.`);
  }
  if (mode === "options") {
    notes.push(
      "Strikes are rounded to an approximate step — confirm the exact strike, expiry, premium and liquidity on the NSE option chain. Premiums, OI and IV are not included.",
    );
  }
  notes.push(`${MODE_INFO[mode].timeframe}. Rule-based technical screen — not investment advice.`);

  return {
    mode,
    asOf: new Date().toISOString(),
    dataAsOf: latest ? new Date(latest * 1000).toISOString() : null,
    scanned: symbols.length,
    failed,
    picks,
    notes,
  };
}

const TTL_MS: Record<Mode, number> = {
  intraday: 90_000,
  options: 4 * 60_000,
  "short-term": 15 * 60_000,
  "long-term": 60 * 60_000,
};
const MIN_FORCE_INTERVAL_MS = 30_000;
const cache = new Map<Mode, { at: number; promise: Promise<ScreenResult> }>();

/** Cached per mode; concurrent callers share one in-flight scan. */
export function runScreen(mode: Mode, force = false): Promise<ScreenResult> {
  const hit = cache.get(mode);
  const age = hit ? Date.now() - hit.at : Infinity;
  if (hit && (age < (force ? MIN_FORCE_INTERVAL_MS : TTL_MS[mode]))) return hit.promise;
  const promise = compute(mode).catch((error) => {
    cache.delete(mode);
    throw error;
  });
  cache.set(mode, { at: Date.now(), promise });
  return promise;
}
