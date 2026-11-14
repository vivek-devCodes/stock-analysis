// Contract for per-stock insights (quick agent verdict + risk profile) and the Sector module.
// Client-safe: no server-only imports.

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

/** Risk management numbers for one stock, from ~1 year of daily candles. Fractions are 0–1. */
export type RiskProfile = {
  level: RiskLevel;
  reasons: string[];
  volatilityAnnual: number | null; // annualised std-dev of daily returns
  maxDrawdown3m: number | null; // worst peak-to-trough fall in the last ~63 sessions (negative)
  beta: number | null; // vs NIFTY 50, 1 year
  var95OneDay: number | null; // 1-day historical Value-at-Risk at 95% (negative return)
  atrPct: number | null; // daily ATR as a fraction of price
  avgDailyValueCr: number | null; // average daily traded value, ₹ crore
  suggestedStop: number | null; // 2 × ATR below price
  illustrativeQty: number | null; // shares for ₹1,00,000 risking 1% to that stop
  maxLossAtStop: number | null; // ₹ lost at the stop for the illustrative position
};

export type QuickVerdict = {
  /** A screening view, NOT a validated recommendation — use the full agent analysis for that. */
  stance: "CONSIDER" | "WATCH" | "AVOID" | "NEUTRAL";
  horizonHint: "swing" | "long-term" | null;
  summary: string;
  reasons: string[];
  /** Whether the underlying rule set is backtested and proven (it currently is not). */
  evidence: "proven" | "unproven" | "untested";
  fundamentalScore: number | null;
  trend: "up" | "down" | "mixed" | "unknown";
};

export type StockInsight = {
  symbol: string;
  name: string;
  sector: string;
  price: number | null;
  asOf: string;
  verdict: QuickVerdict;
  risk: RiskProfile;
  /** Opens the full multi-agent analysis for this stock. */
  agentHref: string;
};

export type Returns = { d1: number | null; m1: number | null; m2: number | null; m3: number | null };

export type SectorSummary = {
  sector: string;
  label: string;
  indexSymbol: string | null;
  index: Returns | null;
  /** Average of constituent returns (equal-weight) from our stock list. */
  avg: Returns;
  /** Share of constituents with a positive return over each window (0–1). */
  profitableShare: Returns;
  breadthToday: { up: number; down: number; flat: number };
  /** Up-day volume ÷ down-day volume over 20 sessions — a price-volume proxy for buying/selling pressure. */
  upDownVolumeRatio: number | null;
  pressure: "buying" | "selling" | "neutral";
  stocks: number;
};

export type SectorStock = {
  symbol: string;
  name: string;
  price: number | null;
  returns: Returns;
  fundamentalScore: number | null;
  verdict: QuickVerdict;
  risk: RiskProfile;
  agentHref: string;
};

export type SectorsResponse = { asOf: string; sectors: SectorSummary[]; notes: string[] };
export type SectorDetailResponse = { asOf: string; sector: SectorSummary; stocks: SectorStock[]; notes: string[] };
