// Portfolio risk rules for paper trading, applied before every new entry. Pure; safe on client
// and server; covered by src/scripts/test-learn.ts. The server wrapper is guard.ts.

import { THRESHOLDS } from "../agents/thresholds";
import { SECTORS } from "../stock-universe";
import type { StockDay } from "../exchange/types";
import type { Regime } from "./regime";
import type { PaperSide } from "./types";

const G = THRESHOLDS.guard;

const SECTOR_OF = new Map<string, string>();
for (const [sector, list] of Object.entries(SECTORS)) for (const s of list) if (!SECTOR_OF.has(s)) SECTOR_OF.set(s, sector);

/** Sector of a Yahoo symbol from the app's sector map; null when it is not in the map (not capped). */
export const sectorOf = (symbol: string): string | null => SECTOR_OF.get(symbol) ?? SECTOR_OF.get(`${symbol.replace(/\.(NS|BO)$/, "")}.NS`) ?? null;

export type GuardState = {
  capital: number;
  /** Net P&L of recommended trades closed today (₹). */
  todayClosedNet: number;
  /** Recommended trades currently open. */
  open: Array<{ symbol: string }>;
  /** Net P&L of every closed recommended trade since the last drawdown reset, oldest first. */
  closedNets: number[];
  regime: Regime | null;
};

export type Guard = {
  /** False = no new recommended trades at all (they are paper-traded as shadow instead). */
  allowNew: boolean;
  reasons: string[];
  sizeMult: number;
  /** New recommended trades still allowed now. */
  slots: number;
  sectorCounts: Record<string, number>;
  drawdownPct: number;
  paused: boolean;
  dailyLossHit: boolean;
  regime: Regime | null;
};

export function drawdownPct(capital: number, closedNets: number[]): number {
  let equity = capital;
  let peak = capital;
  for (const n of closedNets) {
    equity += n;
    peak = Math.max(peak, equity);
  }
  return peak > 0 ? ((peak - equity) / peak) * 100 : 0;
}

export function evaluateGuard(s: GuardState): Guard {
  const reasons: string[] = [];
  const dd = drawdownPct(s.capital, s.closedNets);
  const paused = dd >= G.drawdownPausePct;
  if (paused) reasons.push(`Drawdown ${dd.toFixed(1)}% ≥ ${G.drawdownPausePct}% — recommended trades paused until you resume them on the Scorecard page`);
  const dailyLossHit = s.todayClosedNet <= -(s.capital * G.dailyLossPct) / 100;
  if (dailyLossHit) reasons.push(`Daily loss limit reached (₹${Math.round(-s.todayClosedNet).toLocaleString("en-IN")} ≥ ${G.dailyLossPct}% of capital)`);
  const regime = s.regime;
  if (regime?.level === "stand-aside") reasons.push(`Market regime: stand aside (${regime.notes[0] ?? ""})`);

  // The regime caps total open positions (calm 5, caution 3, stand aside 0).
  const maxOpen = regime ? Math.min(G.maxOpen, regime.maxNewTrades) : G.maxOpen;
  const slots = Math.max(0, maxOpen - s.open.length);
  if (!slots && !paused && !dailyLossHit && regime?.level !== "stand-aside") reasons.push(`Position limit reached (${s.open.length} open, max ${maxOpen} in this regime)`);

  const sectorCounts: Record<string, number> = {};
  for (const o of s.open) {
    const sec = sectorOf(o.symbol);
    if (sec) sectorCounts[sec] = (sectorCounts[sec] ?? 0) + 1;
  }
  const allowNew = !paused && !dailyLossHit && regime?.level !== "stand-aside" && slots > 0;
  return { allowNew, reasons, sizeMult: regime?.sizeMult ?? 1, slots, sectorCounts, drawdownPct: dd, paused, dailyLossHit, regime };
}

/**
 * Can this candidate be a recommended trade under the guard? Returns null when it can (and books
 * its slot and sector), otherwise the reason it is paper-traded as shadow instead.
 */
export function admit(g: Guard, c: { symbol: string; side: PaperSide }): string | null {
  if (!g.allowNew) return g.reasons[0] ?? "Risk rules: no new trades";
  if (g.slots <= 0) return "Position limit reached";
  if (g.regime && c.side === "long" && !g.regime.allowLong) return "Market regime: NIFTY in a downtrend — longs are shadow-only";
  if (g.regime && c.side === "short" && !g.regime.allowShort) return "Market regime: NIFTY in an uptrend — shorts are shadow-only";
  const sec = sectorOf(c.symbol);
  if (sec && (g.sectorCounts[sec] ?? 0) >= G.maxPerSector) return `Sector limit: already ${G.maxPerSector} ${sec} positions`;
  g.slots -= 1;
  if (sec) g.sectorCounts[sec] = (g.sectorCounts[sec] ?? 0) + 1;
  return null;
}

/**
 * Shares for a fixed rupee risk (capital × risk% ÷ stop distance), then scaled by the regime,
 * capped at maxPositionPct of capital, and cut for stocks whose daily range (ATR %) is above the
 * cap — so a volatile stock gets fewer shares.
 */
export function positionSize(entry: number, stop: number, capital: number, riskPct: number, opts: { mult?: number; atrPct?: number | null } = {}): number {
  const dist = Math.abs(entry - stop);
  if (!(dist > 0) || !(entry > 0)) return 0;
  let qty = (capital * riskPct) / 100 / dist;
  qty *= opts.mult ?? 1;
  if (opts.atrPct != null && opts.atrPct > G.atrCapPct) qty *= G.atrCapPct / opts.atrPct;
  qty = Math.min(qty, (capital * G.maxPositionPct) / 100 / entry);
  return Math.max(0, Math.floor(qty));
}

/**
 * Typical daily move (ATR proxy, % of price) from NSE data: NSE Clearing's annualised volatility
 * for F&O stocks (daily σ × 1.25 ≈ ATR), otherwise the last session's high–low range.
 */
export function atrPctOf(s: StockDay | null | undefined): number | null {
  if (!s) return null;
  if (s.annualVol != null && s.annualVol > 0) return (s.annualVol / Math.sqrt(252)) * 125;
  return s.close > 0 && s.high >= s.low ? ((s.high - s.low) / s.close) * 100 : null;
}
