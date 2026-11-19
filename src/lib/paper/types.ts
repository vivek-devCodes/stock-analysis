// Paper trading: shared contract for the server engine and the Paper Trading page.
// Keep this file free of server-only imports.

import type { AgentId, Bias, Decision, Validation } from "../agents/types";

export type PaperSide = "long" | "short";

/** open → exactly one of: target hit, stop hit, or squared off at the intraday cut-off. */
export type PaperStatus = "open" | "target" | "stop" | "square-off";

/**
 * recommended — the agent said BUY / SELL (APPROVED) or WATCHLIST (approved with conditions).
 * shadow      — the agent had a directional plan but said NO TRADE. Traded on paper only to
 *               measure whether rejecting it was the right call. Never counted in the headline P&L.
 */
export type PaperKind = "recommended" | "shadow";

export type AgentVote = { agent: AgentId; bias: Bias | null; score: number | null };

export type PaperTrade = {
  id: string;
  /** IST trading day, YYYY-MM-DD. One trade per symbol per day. */
  tradeDay: string;
  symbol: string;
  name: string;
  openedAt: string;
  trigger: "auto" | "manual";
  kind: PaperKind;
  side: PaperSide;
  decision: Decision;
  validation: Validation;
  score: number | null;
  entry: number;
  target: number;
  stop: number;
  qty: number;
  riskReward: number | null;
  reasons: string[];
  votes: AgentVote[];
  reportId: string | null;
  status: PaperStatus;
  exitPrice: number | null;
  exitAt: string | null;
  grossPnl: number | null;
  costs: number | null;
  netPnl: number | null;
  /** Net P&L as % of the position value. */
  returnPct: number | null;
};

/** A trade as the page sees it: stored fields plus a live mark for open positions. */
export type PaperTradeView = PaperTrade & { lastPrice: number | null; unrealizedPnl: number | null };

export type MarketPhase = "weekend" | "pre-open" | "warm-up" | "open" | "no-new-entries" | "closed";

export type PaperRunResult = {
  at: string;
  trigger: "auto" | "manual";
  phase: MarketPhase;
  /** Why nothing was opened, when that is the case. */
  skipped: string | null;
  shortlisted: string[];
  analysed: number;
  opened: Array<{ symbol: string; kind: PaperKind; side: PaperSide; decision: Decision }>;
  notTraded: Array<{ symbol: string; reason: string }>;
  errors: string[];
};

export type PaperSnapshot = {
  persisted: boolean;
  note: string | null;
  phase: MarketPhase;
  phaseLabel: string;
  today: string;
  autoRanToday: boolean;
  trades: PaperTradeView[];
  settings: PaperSettings;
};

export type PaperSettings = {
  capital: number;
  riskPct: number;
  costPct: number;
  squareOff: string;
  entryWindow: string;
};
