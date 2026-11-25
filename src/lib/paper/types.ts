// Paper trading: shared contract for the server engine and the Paper Trading page.
// Keep this file free of server-only imports.

import type { AgentId, Bias, Decision, Validation } from "../agents/types";
import type { Regime } from "./regime";

export type PaperSide = "long" | "short";

/** open → exactly one of: target hit, stop hit, stopped at entry after the break-even move, or squared off at the intraday cut-off. */
export type PaperStatus = "open" | "target" | "stop" | "breakeven" | "square-off";

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
  /** auto / manual = the live agent run; plan = entered at the open from last night's plan. */
  trigger: "auto" | "manual" | "plan";
  /** For plan trades: the session date the plan was made after. */
  planMadeOn?: string | null;
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
  /** Set when the agent recommended the trade but a risk rule demoted it to shadow. */
  riskNote?: string | null;
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
  /** Last night's plan, executed first at the open (null when there was none pending). */
  plan?: PlanExecution | null;
  /** Risk-rule and market-regime notes that applied to this run. */
  risk?: string[];
};

/* ------------------------------ Next-session plan (built after the close) ------------------------------ */

export type PlanItem = {
  symbol: string;
  name: string;
  kind: PaperKind;
  side: PaperSide;
  decision: Decision;
  validation: Validation;
  score: number | null;
  /** Last price when the plan was made (the previous close). */
  refPrice: number;
  entryLow: number;
  entryHigh: number;
  trigger: string;
  stop: number;
  target: number;
  riskReward: number | null;
  reasons: string[];
  /** NSE exchange evidence that shaped the pick (delivery, build-up, PCR, deals…). */
  exchange: Array<{ label: string; value: string; effect: string; source: string }>;
  votes: AgentVote[];
  reportId: string | null;
};

export type PlanExecutionRow = {
  symbol: string;
  entered: boolean;
  reason: string;
  price: number | null;
  tradeId: string | null;
  /** False while the item is still waiting for its opening-range breakout. */
  final?: boolean;
  /** Opening range (first 15 minutes) used for the breakout entry. */
  range?: { high: number; low: number } | null;
};

export type PlanExecution = { day: string; at: string; rows: PlanExecutionRow[]; risk?: string[] };

export type SessionPlan = {
  /** IST date of the session the plan was made after. */
  madeOn: string;
  createdAt: string;
  /** Exchange files the plan used (YYYY-MM-DD). */
  exchangeDate: string | null;
  /** NSE files that were not yet published when the plan was built (it is rebuilt once they are). */
  missingFiles?: string[];
  status: "pending" | "executing" | "executed" | "expired";
  marketNote: string;
  screened: number;
  items: PlanItem[];
  skipped: Array<{ symbol: string; reason: string }>;
  /** Every directional candidate the screen produced (for the random-picks baseline). */
  candidates?: Array<{ symbol: string; side: PaperSide; score: number }>;
  /** Market regime when the plan was built. */
  regime?: Regime | null;
  errors: string[];
  execution: PlanExecution | null;
};

/* ----------------------------------------- Daily report ----------------------------------------- */

export type ReportRow = {
  symbol: string;
  origin: "plan" | "live";
  kind: PaperKind;
  side: PaperSide;
  decision: Decision;
  entry: number;
  exitPrice: number | null;
  status: PaperStatus;
  netPnl: number | null;
  returnPct: number | null;
  /** The agent's call was right: closed with a net profit. Null while open. */
  correct: boolean | null;
};

export type ReportGroup = { trades: number; closed: number; wins: number; losses: number; winRate: number | null; netPnl: number; targetHits: number; stopHits: number; squareOffs: number };

export type DailyReport = {
  day: string;
  createdAt: string;
  headline: string;
  planMadeOn: string | null;
  planIdeas: number;
  planEntered: number;
  planSkipped: Array<{ symbol: string; reason: string }>;
  plan: ReportGroup;
  live: ReportGroup;
  shadow: ReportGroup;
  recommended: ReportGroup;
  rows: ReportRow[];
  emailed: string | null;
};

export type PaperSnapshot = {
  persisted: boolean;
  note: string | null;
  phase: MarketPhase;
  phaseLabel: string;
  today: string;
  autoRanToday: boolean;
  trades: PaperTradeView[];
  /** The latest next-session plan (pending, or the one executed most recently). */
  plan: SessionPlan | null;
  /** Daily reports, newest first. */
  reports: DailyReport[];
  settings: PaperSettings;
};

export type PaperSettings = {
  capital: number;
  riskPct: number;
  costPct: number;
  squareOff: string;
  entryWindow: string;
};
