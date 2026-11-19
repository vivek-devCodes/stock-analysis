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
 *  - Not resolved by 15:15 IST → squared off at the close of the last candle before 15:15.
 *
 * Returns null while the trade is still live (before square-off, or candles not yet available).
 */
export function replayTrade(t: ReplayInput, candles: Candle[], nowSeconds: number, barSeconds = 300): ReplayResult | null {
  const cutoff = istTimeOn(t.openedAt, SESSION.squareOff);
  const long = t.side === "long";
  const sorted = [...candles].sort((a, b) => a.time - b.time);
  const bars = sorted.filter((c) => c.time >= t.openedAt && c.time < cutoff);

  for (const c of bars) {
    if (long ? c.open <= t.stop : c.open >= t.stop) return { status: "stop", exitPrice: c.open, exitAt: c.time };
    if (long ? c.low <= t.stop : c.high >= t.stop) return { status: "stop", exitPrice: t.stop, exitAt: c.time + barSeconds };
    if (long ? c.high >= t.target : c.low <= t.target) return { status: "target", exitPrice: t.target, exitAt: c.time + barSeconds };
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
