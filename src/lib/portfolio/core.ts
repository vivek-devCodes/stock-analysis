// Momentum + quality portfolio: a basket of strong, profitable, low-debt stocks in an uptrend,
// equal-weighted and rebalanced monthly. Pure; safe on client and server; covered by
// src/scripts/test-learn.ts.

import { THRESHOLDS } from "../agents/thresholds";

export const PORTFOLIO = {
  capital: 1_000_000, // ₹10 lakh paper capital
  size: 12, // stocks held
  maxPerSector: 3,
  minQuality: 50, // fundamentals quality score (0–100)
  minRoe: 12, // %
  maxDebtToEquity: 1.5, // non-financials only
  costPct: THRESHOLDS.costs.deliveryRoundTripPct, // round trip; half charged on each buy or sell
} as const;

export type Candidate = {
  symbol: string;
  name: string;
  sector: string;
  price: number;
  /** 12-month return excluding the last month (the classic momentum measure), %. */
  mom12: number | null;
  /** 6-month return excluding the last month, %. */
  mom6: number | null;
  aboveSma200: boolean | null;
  quality: number | null;
  roe: number | null;
  debtToEquity: number | null;
  financial: boolean;
};

export type Holding = { symbol: string; name: string; sector: string; qty: number; entryPrice: number; entryDay: string; reasons: string[] };

export type Rebalance = {
  day: string;
  createdAt: string;
  navBefore: number;
  navAfter: number;
  costs: number;
  cash: number;
  holdings: Holding[];
  entered: string[];
  exited: string[];
  kept: string[];
  screened: number;
  eligible: number;
  rejected: Array<{ symbol: string; reason: string }>;
};

/** Returns over the window ending one month (21 sessions) ago, from daily closes (oldest first). */
export function momentumOf(closes: number[]): { mom12: number | null; mom6: number | null; aboveSma200: boolean | null } {
  const c = closes.filter((x) => Number.isFinite(x) && x > 0);
  const n = c.length;
  const lagged = n > 21 ? c[n - 22] : null;
  const ret = (back: number) => (lagged != null && n > back ? ((lagged - c[n - 1 - back]) / c[n - 1 - back]) * 100 : null);
  const mom12 = n >= 200 ? ((lagged! - c[0]) / c[0]) * 100 : null;
  const sma200 = n >= 200 ? c.slice(-200).reduce((a, b) => a + b, 0) / 200 : null;
  return { mom12, mom6: ret(126), aboveSma200: sma200 != null ? c[n - 1] > sma200 : null };
}

/** Percentile rank (0–1) of each value within the list. */
function pctRank(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  return values.map((v) => (sorted.length > 1 ? sorted.indexOf(v) / (sorted.length - 1) : 1));
}

export function selectBasket(cands: Candidate[]): { picks: Array<Candidate & { rank: number; reasons: string[] }>; eligible: number; rejected: Array<{ symbol: string; reason: string }> } {
  const rejected: Array<{ symbol: string; reason: string }> = [];
  const ok = cands.filter((c) => {
    const mom = c.mom12 ?? c.mom6;
    const why =
      mom == null ? "Not enough price history" :
      c.aboveSma200 === false ? "Below its 200-day average (downtrend)" :
      mom <= 0 ? `Negative momentum (${mom.toFixed(0)}%)` :
      c.quality == null || c.quality < PORTFOLIO.minQuality ? `Quality score ${c.quality ?? "—"} < ${PORTFOLIO.minQuality}` :
      c.roe != null && c.roe < PORTFOLIO.minRoe ? `ROE ${c.roe.toFixed(0)}% < ${PORTFOLIO.minRoe}%` :
      !c.financial && c.debtToEquity != null && c.debtToEquity > PORTFOLIO.maxDebtToEquity ? `Debt/equity ${c.debtToEquity.toFixed(1)} > ${PORTFOLIO.maxDebtToEquity}` :
      null;
    if (why) rejected.push({ symbol: c.symbol, reason: why });
    return !why;
  });
  const mom = pctRank(ok.map((c) => ((c.mom12 ?? c.mom6)! + (c.mom6 ?? c.mom12)!) / 2));
  const qual = pctRank(ok.map((c) => c.quality!));
  const ranked = ok.map((c, i) => ({ ...c, rank: 0.5 * mom[i] + 0.5 * qual[i] })).sort((a, b) => b.rank - a.rank);
  const picks: Array<Candidate & { rank: number; reasons: string[] }> = [];
  const perSector = new Map<string, number>();
  for (const c of ranked) {
    if (picks.length >= PORTFOLIO.size) break;
    if ((perSector.get(c.sector) ?? 0) >= PORTFOLIO.maxPerSector) {
      rejected.push({ symbol: c.symbol, reason: `Sector cap (${PORTFOLIO.maxPerSector} ${c.sector} stocks already)` });
      continue;
    }
    perSector.set(c.sector, (perSector.get(c.sector) ?? 0) + 1);
    picks.push({
      ...c,
      reasons: [
        `Momentum: ${c.mom12 != null ? `${c.mom12.toFixed(0)}% over 12 months` : "—"}${c.mom6 != null ? `, ${c.mom6.toFixed(0)}% over 6 months` : ""} (excluding the last month)`,
        `Quality ${c.quality}/100${c.roe != null ? `, ROE ${c.roe.toFixed(0)}%` : ""}${!c.financial && c.debtToEquity != null ? `, debt/equity ${c.debtToEquity.toFixed(2)}` : ""}`,
        "Above its 200-day average",
      ],
    });
  }
  return { picks, eligible: ok.length, rejected };
}

/** Portfolio value at the given prices (falls back to entry price when a quote is missing). */
export function valueOf(holdings: Holding[], cash: number, prices: Map<string, number>): number {
  return cash + holdings.reduce((a, h) => a + h.qty * (prices.get(h.symbol) ?? h.entryPrice), 0);
}

/**
 * Equal-weight rebalance into `picks` at `prices`. Stocks that stay are resized; costs are charged
 * on the traded value (half the round-trip cost per side).
 */
export function rebalance(input: { day: string; prev: { holdings: Holding[]; cash: number } | null; picks: Array<Candidate & { reasons: string[] }>; prices: Map<string, number> }): Omit<Rebalance, "screened" | "eligible" | "rejected" | "createdAt"> {
  const prevHoldings = input.prev?.holdings ?? [];
  const navBefore = input.prev ? valueOf(prevHoldings, input.prev.cash, input.prices) : PORTFOLIO.capital;
  const sideCost = PORTFOLIO.costPct / 100 / 2;
  const picks = input.picks.filter((p) => (input.prices.get(p.symbol) ?? p.price) > 0);
  const target = picks.length ? (navBefore * (1 - sideCost)) / picks.length : 0;
  let traded = 0;
  const holdings: Holding[] = picks.map((p) => {
    const price = input.prices.get(p.symbol) ?? p.price;
    const qty = Math.floor(target / price);
    const old = prevHoldings.find((h) => h.symbol === p.symbol);
    traded += Math.abs(qty - (old?.qty ?? 0)) * price;
    return { symbol: p.symbol, name: p.name, sector: p.sector, qty, entryPrice: old ? old.entryPrice : price, entryDay: old ? old.entryDay : input.day, reasons: p.reasons };
  });
  for (const h of prevHoldings) if (!holdings.some((x) => x.symbol === h.symbol)) traded += h.qty * (input.prices.get(h.symbol) ?? h.entryPrice);
  const costs = traded * sideCost;
  const invested = holdings.reduce((a, h) => a + h.qty * (input.prices.get(h.symbol) ?? h.entryPrice), 0);
  const cash = navBefore - invested - costs;
  return {
    day: input.day,
    navBefore,
    navAfter: invested + cash,
    costs,
    cash,
    holdings,
    entered: holdings.filter((h) => !prevHoldings.some((x) => x.symbol === h.symbol)).map((h) => h.symbol),
    exited: prevHoldings.filter((h) => !holdings.some((x) => x.symbol === h.symbol)).map((h) => h.symbol),
    kept: holdings.filter((h) => prevHoldings.some((x) => x.symbol === h.symbol)).map((h) => h.symbol),
  };
}
