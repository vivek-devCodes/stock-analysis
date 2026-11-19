// Pure scoring of paper trades. Safe on client and server; covered by src/scripts/test-paper.ts.

import { AGENT_LABELS, type AgentId } from "../agents/types";
import type { PaperTrade } from "./types";

export type GroupStats = {
  trades: number;
  open: number;
  closed: number;
  /** Closed with net P&L > 0 — "the decision was correct". */
  wins: number;
  losses: number;
  winRate: number | null;
  targetHits: number;
  stopHits: number;
  squareOffs: number;
  netPnl: number;
  grossProfit: number;
  grossLoss: number;
  avgWin: number | null;
  avgLoss: number | null;
  /** Gross profit ÷ gross loss (net of costs). Null when there are no losses yet. */
  profitFactor: number | null;
  /** Average net P&L per closed trade (₹). */
  expectancy: number | null;
  avgReturnPct: number | null;
  best: number | null;
  worst: number | null;
};

export type AgentAccuracy = {
  agent: AgentId;
  label: string;
  /** Closed trades where this specialist took a side (bullish or bearish). */
  calls: number;
  correct: number;
  accuracy: number | null;
  neutral: number;
};

export type DayStats = { day: string; trades: number; closed: number; wins: number; netPnl: number };

export type PaperStats = {
  /** Recommended trades only (BUY / SELL / WATCHLIST) — the agent's real track record. */
  overall: GroupStats;
  byVerdict: Array<{ key: string; label: string; hint: string; stats: GroupStats }>;
  bySide: Array<{ key: string; label: string; stats: GroupStats }>;
  agents: AgentAccuracy[];
  days: DayStats[];
};

const isClosed = (t: PaperTrade) => t.status !== "open" && t.netPnl != null;

export function groupStats(trades: PaperTrade[]): GroupStats {
  const closed = trades.filter(isClosed);
  const nets = closed.map((t) => t.netPnl!);
  const winsArr = nets.filter((n) => n > 0);
  const lossArr = nets.filter((n) => n <= 0);
  const grossProfit = winsArr.reduce((a, b) => a + b, 0);
  const grossLoss = -lossArr.reduce((a, b) => a + b, 0);
  const sum = nets.reduce((a, b) => a + b, 0);
  const rets = closed.map((t) => t.returnPct ?? 0);
  return {
    trades: trades.length,
    open: trades.length - closed.length,
    closed: closed.length,
    wins: winsArr.length,
    losses: lossArr.length,
    winRate: closed.length ? winsArr.length / closed.length : null,
    targetHits: closed.filter((t) => t.status === "target").length,
    stopHits: closed.filter((t) => t.status === "stop").length,
    squareOffs: closed.filter((t) => t.status === "square-off").length,
    netPnl: sum,
    grossProfit,
    grossLoss,
    avgWin: winsArr.length ? grossProfit / winsArr.length : null,
    avgLoss: lossArr.length ? -grossLoss / lossArr.length : null,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    expectancy: closed.length ? sum / closed.length : null,
    avgReturnPct: rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : null,
    best: nets.length ? Math.max(...nets) : null,
    worst: nets.length ? Math.min(...nets) : null,
  };
}

/**
 * A specialist agent is "correct" on a closed trade when the side it took matches how the price
 * actually moved from entry to exit (bullish and the exit was above entry, or bearish and below).
 * Neutral views and flat exits are not counted. Uses every closed trade, including shadow ones,
 * because a specialist's view is independent of the final verdict.
 */
export function agentAccuracy(trades: PaperTrade[]): AgentAccuracy[] {
  const acc = new Map<AgentId, AgentAccuracy>();
  for (const t of trades) {
    if (!isClosed(t) || t.exitPrice == null) continue;
    const move = Math.sign(t.exitPrice - t.entry);
    for (const v of t.votes) {
      const row = acc.get(v.agent) ?? { agent: v.agent, label: AGENT_LABELS[v.agent] ?? v.agent, calls: 0, correct: 0, accuracy: null, neutral: 0 };
      if (v.bias === "bullish" || v.bias === "bearish") {
        if (move !== 0) {
          row.calls += 1;
          if ((v.bias === "bullish" && move > 0) || (v.bias === "bearish" && move < 0)) row.correct += 1;
        }
      } else row.neutral += 1;
      acc.set(v.agent, row);
    }
  }
  return [...acc.values()]
    .map((r) => ({ ...r, accuracy: r.calls ? r.correct / r.calls : null }))
    .sort((a, b) => (b.accuracy ?? -1) - (a.accuracy ?? -1) || b.calls - a.calls);
}

export function computeStats(trades: PaperTrade[]): PaperStats {
  const rec = trades.filter((t) => t.kind === "recommended");
  const days = new Map<string, DayStats>();
  for (const t of rec) {
    const d = days.get(t.tradeDay) ?? { day: t.tradeDay, trades: 0, closed: 0, wins: 0, netPnl: 0 };
    d.trades += 1;
    if (isClosed(t)) {
      d.closed += 1;
      d.netPnl += t.netPnl!;
      if (t.netPnl! > 0) d.wins += 1;
    }
    days.set(t.tradeDay, d);
  }
  return {
    overall: groupStats(rec),
    byVerdict: [
      { key: "approved", label: "BUY / SELL (approved)", hint: "Passed every check, including a proven backtested edge.", stats: groupStats(rec.filter((t) => t.validation === "APPROVED")) },
      { key: "watchlist", label: "WATCHLIST (conditional)", hint: "Setup passed, but its probability is not yet proven.", stats: groupStats(rec.filter((t) => t.validation === "APPROVED WITH CONDITIONS")) },
      { key: "shadow", label: "Rejected (shadow)", hint: "The agent said NO TRADE. Lower P&L here than above means rejecting was right.", stats: groupStats(trades.filter((t) => t.kind === "shadow")) },
    ],
    bySide: [
      { key: "long", label: "Long (buy first)", stats: groupStats(rec.filter((t) => t.side === "long")) },
      { key: "short", label: "Short (sell first)", stats: groupStats(rec.filter((t) => t.side === "short")) },
    ],
    agents: agentAccuracy(trades),
    days: [...days.values()].sort((a, b) => b.day.localeCompare(a.day)),
  };
}
