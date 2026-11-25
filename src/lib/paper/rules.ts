// Pure paper-trading rules: market clock, candle replay and P&L. No I/O, safe on client and server,
// and covered by src/scripts/test-paper.ts.

import { THRESHOLDS } from "../agents/thresholds";
import type { Candle } from "../types";
import type { MarketPhase, PaperSettings, PaperSide, PaperStatus } from "./types";

const IST_OFFSET_S = 5.5 * 3600;
const MIN = 60;

/** NSE cash session in IST minutes after midnight. */
export const SESSION = {
  open: 9 * 60 + 15,
  /** No entries before 09:30 — the intraday scanner needs the 30-minute opening range. */
  firstEntry: 9 * 60 + 30,
  /** No new entries after 14:30, so every trade has time to work before square-off. */
  lastEntry: 14 * 60 + 30,
  /** Open positions are squared off at 15:15 (brokers auto-square around 15:20). */
  squareOff: 15 * 60 + 15,
  close: 15 * 60 + 30,
} as const;

export const COST_RATE = THRESHOLDS.costs.intradayRoundTripPct / 100;

export const PAPER_SETTINGS: PaperSettings = {
  capital: THRESHOLDS.risk.illustrativeCapital,
  riskPct: THRESHOLDS.risk.illustrativeRiskPct,
  costPct: THRESHOLDS.costs.intradayRoundTripPct,
  squareOff: "15:15 IST",
  entryWindow: "09:30–14:30 IST",
};

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** IST calendar day (YYYY-MM-DD) for a unix-seconds time. */
export function istDate(unixSeconds: number): string {
  return new Date((unixSeconds + IST_OFFSET_S) * 1000).toISOString().slice(0, 10);
}

/** Unix seconds of a given IST minute-of-day on the IST day containing `unixSeconds`. */
export function istTimeOn(unixSeconds: number, minuteOfDay: number): number {
  const istMidnight = Math.floor((unixSeconds + IST_OFFSET_S) / 86400) * 86400 - IST_OFFSET_S;
  return istMidnight + minuteOfDay * MIN;
}

/** Where the NSE session stands by the clock (exchange holidays are checked separately). */
export function marketPhase(unixSeconds: number): MarketPhase {
  const ist = new Date((unixSeconds + IST_OFFSET_S) * 1000);
  const day = ist.getUTCDay();
  if (day === 0 || day === 6) return "weekend";
  const m = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  if (m < SESSION.open) return "pre-open";
  if (m < SESSION.firstEntry) return "warm-up";
  if (m < SESSION.lastEntry) return "open";
  if (m < SESSION.close) return "no-new-entries";
  return "closed";
}

export const PHASE_LABEL: Record<MarketPhase, string> = {
  weekend: "Weekend — market closed",
  "pre-open": `Pre-open — the agent starts trading at ${hhmm(SESSION.firstEntry)} IST`,
  "warm-up": `Market open — waiting for the opening range (entries from ${hhmm(SESSION.firstEntry)})`,
  open: `Market open — agent can enter trades until ${hhmm(SESSION.lastEntry)} IST`,
  "no-new-entries": `No new entries after ${hhmm(SESSION.lastEntry)} — open trades square off at ${hhmm(SESSION.squareOff)}`,
  closed: "Market closed — trades are settled from today's candles",
};

export type ReplayInput = { side: PaperSide; entry: number; target: number; stop: number; openedAt: number };
export type ReplayResult = { status: Exclude<PaperStatus, "open">; exitPrice: number; exitAt: number };

/**
 * Replay the candles after entry and decide how the trade ended.
 *
 *  - Only candles that START at or after the entry time count (no look-ahead into the entry bar).
 *  - A candle that opens beyond the stop exits at its open (a gap — worse than the stop).
 *  - If one candle touches both the stop and the target, the stop is assumed first (conservative).
 *  - A target fills at the target price (no credit for favourable gaps).
 *  - Once a candle closes the trade `breakEvenR` × risk in profit, the stop moves to the entry for
 *    the following candles (exit at entry = "breakeven"). Pass 0 to disable.
 *  - Not resolved by 15:15 IST → squared off at the close of the last candle before 15:15.
 *
 * Returns null while the trade is still live (before square-off, or candles not yet available).
 */
export function replayTrade(t: ReplayInput, candles: Candle[], nowSeconds: number, barSeconds = 300, breakEvenR: number = THRESHOLDS.guard.breakEvenR): ReplayResult | null {
  const cutoff = istTimeOn(t.openedAt, SESSION.squareOff);
  const long = t.side === "long";
  const sorted = [...candles].sort((a, b) => a.time - b.time);
  const bars = sorted.filter((c) => c.time >= t.openedAt && c.time < cutoff);
  const risk = Math.abs(t.entry - t.stop);
  const trigger = breakEvenR > 0 && risk > 0 ? (long ? t.entry + breakEvenR * risk : t.entry - breakEvenR * risk) : null;
  let stop = t.stop;
  let moved = false;

  for (const c of bars) {
    const status = moved ? "breakeven" : "stop";
    if (long ? c.open <= stop : c.open >= stop) return { status, exitPrice: c.open, exitAt: c.time };
    if (long ? c.low <= stop : c.high >= stop) return { status, exitPrice: stop, exitAt: c.time + barSeconds };
    if (long ? c.high >= t.target : c.low <= t.target) return { status: "target", exitPrice: t.target, exitAt: c.time + barSeconds };
    // Move the stop only after the candle has CLOSED past the trigger (no intrabar look-ahead).
    if (!moved && trigger != null && (long ? c.close >= trigger : c.close <= trigger)) {
      stop = t.entry;
      moved = true;
    }
  }

  // Square-off once the session is past the cut-off and the data has caught up (Yahoo's NSE
  // candles lag ~15 minutes), or 45 minutes after the cut-off regardless.
  const dataPastCutoff = sorted.some((c) => c.time >= cutoff - barSeconds);
  if (nowSeconds >= cutoff && (dataPastCutoff || nowSeconds >= cutoff + 45 * MIN)) {
    const before = sorted.filter((c) => c.time < cutoff);
    const last = bars.at(-1) ?? before.at(-1);
    return { status: "square-off", exitPrice: last ? last.close : t.entry, exitAt: last ? Math.min(last.time + barSeconds, cutoff) : cutoff };
  }
  return null;
}

/** Rupee P&L for a closed (or marked) position, after the intraday round-trip cost. */
export function pnl(side: PaperSide, entry: number, exit: number, qty: number, costRate = COST_RATE) {
  const gross = (side === "long" ? exit - entry : entry - exit) * qty;
  const costs = entry * qty * costRate;
  const net = gross - costs;
  const value = entry * qty;
  return { gross, costs, net, returnPct: value > 0 ? (net / value) * 100 : 0 };
}

/**
 * Should a planned trade be entered at this price at the open? It is skipped when the open gapped
 * through the stop (setup invalid) or the target (move missed), or when price already covered
 * `maxChase` of the way to the target (chasing ruins the reward : risk).
 */
export function planEntry(side: PaperSide, ref: number, stop: number, target: number, price: number, maxChase: number): { ok: true } | { ok: false; reason: string } {
  const long = side === "long";
  if (!(price > 0)) return { ok: false, reason: "No live price" };
  if (long ? price <= stop : price >= stop) return { ok: false, reason: `Opened ${long ? "at/below" : "at/above"} the stop (${stop.toFixed(2)}) — setup invalidated by the gap` };
  if (long ? price >= target : price <= target) return { ok: false, reason: `Already ${long ? "above" : "below"} the target (${target.toFixed(2)}) — move missed` };
  const progress = (price - ref) / (target - ref);
  if (progress >= maxChase) return { ok: false, reason: `Already moved ${(progress * 100).toFixed(0)}% of the way to target — not chasing` };
  return { ok: true };
}

/** Position size for a fixed risk budget, capped by capital. */
export function sizeFor(entry: number, stop: number, capital: number, riskPct: number): number {
  const dist = Math.abs(entry - stop);
  if (!(dist > 0) || !(entry > 0)) return 0;
  return Math.max(0, Math.min(Math.floor((capital * riskPct) / 100 / dist), Math.floor(capital / entry)));
}

export type OrbDecision =
  | { action: "enter"; price: number; at: number; range: { high: number; low: number } }
  | { action: "wait"; reason: string; range: { high: number; low: number } | null }
  | { action: "skip"; reason: string; range: { high: number; low: number } | null };

/**
 * Opening-range breakout entry for a planned trade. The range is the first `orbMinutes` of the
 * session; a long enters when price trades above the range high (a short below the low), like a
 * stop-entry order. Fill = the range edge, or the candle's open if it gapped beyond it; the trade
 * is stamped at the END of that candle so settlement never replays bars before the fill.
 * If the stop is touched before any breakout, the setup is void. Pure; tested.
 */
export function orbEntry(input: {
  side: PaperSide;
  ref: number;
  stop: number;
  target: number;
  maxChase: number;
  candles: Candle[];
  sessionOpen: number;
  orbMinutes: number;
  quote: { price: number; time: number } | null;
  barSeconds?: number;
}): OrbDecision {
  const bar = input.barSeconds ?? 300;
  const long = input.side === "long";
  const orEnd = input.sessionOpen + input.orbMinutes * MIN;
  const today = [...input.candles].filter((c) => c.time >= input.sessionOpen).sort((a, b) => a.time - b.time);
  const orBars = today.filter((c) => c.time < orEnd);
  const complete = today.some((c) => c.time >= orEnd - bar);
  if (!orBars.length || !complete) return { action: "wait", reason: "Opening range still forming (candles not yet available)", range: null };
  const range = { high: Math.max(...orBars.map((c) => c.high)), low: Math.min(...orBars.map((c) => c.low)) };
  if (long ? range.low <= input.stop : range.high >= input.stop) return { action: "skip", reason: `Hit the stop (${input.stop.toFixed(2)}) inside the opening range — setup void`, range };

  const decide = (price: number, at: number): OrbDecision => {
    const check = planEntry(input.side, input.ref, input.stop, input.target, price, input.maxChase);
    return check.ok ? { action: "enter", price, at, range } : { action: "skip", reason: check.reason, range };
  };
  for (const c of today.filter((x) => x.time >= orEnd)) {
    if (long ? c.low <= input.stop : c.high >= input.stop) return { action: "skip", reason: "Hit the stop before breaking out of the opening range", range };
    if (long ? c.high > range.high : c.low < range.low) {
      const fill = long ? Math.max(range.high, c.open) : Math.min(range.low, c.open);
      return decide(fill, c.time + bar);
    }
  }
  // Candles lag; the live quote may already show the breakout.
  const q = input.quote;
  if (q && q.time >= orEnd && q.price > 0 && (long ? q.price > range.high : q.price < range.low)) return decide(q.price, q.time);
  return { action: "wait", reason: `Waiting for a ${long ? "break above" : "break below"} the opening range (${(long ? range.high : range.low).toFixed(2)})`, range };
}
