// Shared contract for the multi-agent analysis engine (server) and the AI Analyst page (client).
// Keep this file free of server-only imports.

export type Horizon = "intraday" | "swing" | "long-term";

export const HORIZONS: Array<{ id: Horizon; label: string; hint: string }> = [
  { id: "intraday", label: "Intraday", hint: "Same session · 15-min candles · next-session plan when the market is closed" },
  { id: "swing", label: "Swing / short term", hint: "Days to 2 weeks · daily candles" },
  { id: "long-term", label: "Long term", hint: "3–12 months · fundamentals weighted most" },
];

export type AgentId = "market" | "technical" | "fundamental" | "news" | "ownership" | "fno" | "quant";

export const AGENT_LABELS: Record<AgentId, string> = {
  market: "Market Intelligence",
  technical: "Technical Analysis",
  fundamental: "Fundamental Analysis",
  news: "News & Sentiment",
  ownership: "Ownership & Flows",
  fno: "Futures & Options",
  quant: "Quantitative Research",
};

export type Bias = "bullish" | "bearish" | "neutral";

export type SourceRef = {
  name: string;
  url?: string;
  /** ISO timestamp of the data or publication, when known. */
  timestamp?: string;
  kind: "exchange" | "vendor" | "media" | "backtest" | "model" | "computed";
  /** e.g. "15-min delayed", "end of day", "TTM". */
  note?: string;
};

export type Finding = { label: string; value: string; tone?: "up" | "down" | "warn" };

export type AgentResult = {
  agent: AgentId;
  status: "ok" | "insufficient-data" | "error";
  /** 0–100, or null when the agent could not score (status not ok, or nothing to score). */
  score: number | null;
  bias: Bias | null;
  summary: string;
  findings: Finding[];
  /** Plain-language evidence bullets. */
  evidence: string[];
  warnings: string[];
  sources: SourceRef[];
};

export type NewsItemRef = {
  headline: string;
  source: string;
  url: string;
  publishedAt: string | null;
  sentiment: "positive" | "negative" | "neutral";
  /** Source class per the spec: rumour < unverified < media report < company < exchange < regulator. */
  sourceClass: "media-report" | "aggregator";
  stale: boolean;
};

export type Conflict = { between: [AgentId, AgentId]; description: string; severity: "material" | "minor" };

export type ExpectedValue = {
  /** Where the probability comes from — never an AI guess. */
  probabilityType: "backtested" | "unknown";
  pWin: number | null;
  avgWinPct: number | null;
  avgLossPct: number | null;
  /** Average result per trade after costs (fraction), when backtested. */
  expectancyPct: number | null;
  costsPct: number;
  samples: number;
  period: string | null;
  note: string;
};

export type TradePlan = {
  instrument: string;
  direction: "long" | "short";
  entryLow: number;
  entryHigh: number;
  trigger: string;
  stop: number;
  targets: number[];
  riskReward: number | null;
  quantity: number;
  capitalRequired: number;
  maxLoss: number;
  estimatedCosts: number;
  holdingPeriod: string;
  invalidation: string;
  /** True when sizing used example capital/risk because the user did not configure them. */
  illustrativeSizing: boolean;
};

export type RiskReview = {
  approved: boolean;
  capital: number;
  riskPerTradePct: number;
  illustrative: boolean;
  checks: Array<{ name: string; status: "pass" | "warn" | "fail"; detail: string }>;
  plan: TradePlan | null;
};

export type Validation = "APPROVED" | "APPROVED WITH CONDITIONS" | "REJECTED" | "INSUFFICIENT DATA" | "NO TRADE";

export type Decision = "BUY" | "SELL" | "HOLD" | "WATCHLIST" | "NO TRADE" | "NO INVESTMENT";

export type ValidatorReport = {
  verdict: Validation;
  checks: Array<{ name: string; status: "pass" | "warn" | "fail" | "n/a"; detail: string }>;
  conditions: string[];
  /** Concerns raised by the LLM reviewer (it can only downgrade, never upgrade). */
  llmConcerns: string[];
  llmDowngraded: boolean;
};

export type ScoreBreakdown = {
  total: number | null;
  band: string;
  weights: Record<AgentId, number>;
  components: Array<{ agent: AgentId; weight: number; score: number | null }>;
  /** Share of total weight that had a real score (data quality). */
  coverage: number;
};

export type AnalysisReport = {
  id: string | null;
  version: number | null;
  persisted: boolean;
  createdAt: string;
  request: { symbol: string; horizon: Horizon; capital: number | null; riskPct: number | null };
  instrument: { symbol: string; name: string; exchange: string; sector: string; currency: string };
  price: { value: number | null; timestamp: string | null; source: string; marketOpen: boolean };
  marketRegime: string;
  decision: Decision;
  validation: Validation;
  headline: string;
  executable: boolean;
  score: ScoreBreakdown;
  dataQuality: "good" | "partial" | "poor";
  agents: AgentResult[];
  conflicts: Conflict[];
  expectedValue: ExpectedValue;
  risk: RiskReview;
  validator: ValidatorReport;
  scenarios: { bull: string; base: string; bear: string };
  news: NewsItemRef[];
  narrative: string;
  narrativeBy: "gemini" | "template";
  sources: SourceRef[];
  disclaimers: string[];
  stages: Array<{ stage: string; status: "done" | "skipped" | "failed"; detail: string; ms: number }>;
};

/** POST /api/agent/analyse body. */
export type AnalyseRequest = { symbol: string; horizon: Horizon; capital?: number; riskPct?: number };

/** GET /api/agent/recommendations rows. */
export type RecommendationRow = {
  id: string;
  symbol: string;
  horizon: Horizon;
  createdAt: string;
  updatedAt: string;
  versions: number;
  decision: Decision;
  validation: Validation;
  score: number | null;
  status: "open" | "target-hit" | "stop-hit" | "expired" | "closed";
  outcomeReturnPct: number | null;
};

/* ------------------------------ Autonomous scans (agent sessions) ------------------------------ */

export type ScanSession = "premarket" | "intraday" | "postmarket";

export type ScanItem = {
  symbol: string;
  name: string;
  horizon: Horizon;
  decision: Decision;
  validation: Validation;
  score: number | null;
  headline: string;
  executable: boolean;
  reportId: string | null;
  version: number | null;
  plan: { direction: string; entryLow: number; entryHigh: number; stop: number; target1: number; riskReward: number | null; quantity: number; illustrative: boolean } | null;
  evidence: { probabilityType: "backtested" | "unknown"; hitRate: number | null; expectancyPct: number | null; samples: number };
  reasons: string[];
  failedChecks: string[];
};

export type ScanRun = {
  id: string;
  session: ScanSession;
  startedAt: string;
  finishedAt: string;
  marketRegime: string;
  marketOpen: boolean;
  horizons: Array<{ horizon: Horizon; screened: number; shortlisted: string[]; items: ScanItem[] }>;
  counts: { approved: number; watchlist: number; noTrade: number };
  errors: string[];
  note: string;
};
