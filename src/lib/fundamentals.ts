import "server-only";
import { getAllStocks, SECTORS } from "./stock-universe";
import { fetchQuoteSummary, yahooRaw as raw, yahooRecord as rec } from "./yahoo";

/** Ratios are in display units: percentages as %, debt/equity as a plain ratio (0.5 = 50 %). */
export type Fundamentals = {
  symbol: string;
  name: string;
  sector: string;
  industry: string | null;
  price: number | null;
  marketCapCr: number | null;
  pe: number | null;
  pb: number | null;
  roe: number | null;
  roa: number | null;
  debtToEquity: number | null;
  /** Latest quarter vs the same quarter last year (YoY), as reported by Yahoo. */
  revenueGrowth: number | null;
  earningsGrowth: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  dividendYield: number | null;
  currentRatio: number | null;
  insiderHolding: number | null;
  /** TTM operating and free cash flow, ₹ crore. */
  operatingCashFlowCr: number | null;
  freeCashFlowCr: number | null;
  /** Book value per share; negative = negative net worth. */
  bookValuePerShare: number | null;
  fromHigh52: number | null;
  scores: { quality: number; growth: number; value: number; overall: number };
  flags: string[];
};

export type FundamentalsSnapshot = { stocks: Fundamentals[]; failed: string[]; fetchedAt: string };

const SECTOR_OF = new Map<string, string>();
for (const [sector, list] of Object.entries(SECTORS)) for (const s of list) if (!SECTOR_OF.has(s)) SECTOR_OF.set(s, sector);
const FINANCIAL_SECTORS = new Set(["Banking", "Finance"]);

const pct = (v: number | null) => (v == null ? null : Math.round(v * 1000) / 10);
const round = (v: number | null, d = 2) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);

/** [earned, possible, max]: possible is 0 when the metric is missing, so it isn't counted against the stock. */
type Part = [number, number, number];

function tier(value: number | null, rules: Array<[boolean, number]>, max: number): Part {
  if (value == null) return [0, 0, max];
  for (const [ok, pts] of rules) if (ok) return [pts, max, max];
  return [0, max, max];
}

/**
 * Percentage of available points, pulled toward a neutral 50 in proportion to missing data,
 * so a stock scored on half its metrics can't reach the extremes.
 */
function score(parts: Part[]) {
  const possible = parts.reduce((s, [, p]) => s + p, 0);
  const total = parts.reduce((s, [, , m]) => s + m, 0);
  if (!possible || !total) return 50;
  const raw = (parts.reduce((s, [e]) => s + e, 0) / possible) * 100;
  return Math.round(50 + (raw - 50) * (possible / total));
}

function scoreStock(f: Omit<Fundamentals, "scores" | "flags">, financial: boolean) {
  const { roe, debtToEquity: de, netMargin: nm, currentRatio: cr, revenueGrowth: rg, earningsGrowth: eg, pe, pb, dividendYield: dy } = f;
  const quality = score([
    tier(roe, [[roe! >= 20, 35], [roe! >= 15, 26], [roe! >= 10, 14], [roe! > 0, 5]], 35),
    // Leverage and liquidity ratios don't mean the same thing for banks/NBFCs.
    financial ? [0, 0, 0] : tier(de, [[de! <= 0.1, 25], [de! <= 0.5, 18], [de! <= 1, 8]], 25),
    tier(nm, [[nm! >= 15, 25], [nm! >= 8, 16], [nm! > 0, 6]], 25),
    financial ? [0, 0, 0] : tier(cr, [[cr! >= 1.5, 15], [cr! >= 1, 8]], 15),
  ]);
  const growth = score([
    tier(rg, [[rg! >= 20, 50], [rg! >= 10, 35], [rg! >= 5, 20], [rg! > 0, 8]], 50),
    tier(eg, [[eg! >= 20, 50], [eg! >= 10, 35], [eg! >= 5, 20], [eg! > 0, 8]], 50),
  ]);
  const value = score([
    tier(pe, [[pe! > 0 && pe! <= 12, 40], [pe! > 0 && pe! <= 20, 30], [pe! > 0 && pe! <= 30, 16], [pe! > 0 && pe! <= 45, 6]], 40),
    tier(pb, [[pb! <= 1.5, 30], [pb! <= 3, 20], [pb! <= 6, 8]], 30),
    tier(dy, [[dy! >= 3, 30], [dy! >= 1.5, 18], [dy! >= 0.5, 8]], 30),
  ]);
  const overall = Math.round(quality * 0.45 + growth * 0.3 + value * 0.25);

  const flags: string[] = [];
  if (!financial && de != null && de > 1) flags.push("High debt");
  // A high ROE can come from leverage rather than a better business (DuPont: ROE = margin × turnover × leverage).
  if (!financial && roe != null && roe >= 20 && de != null && de > 1) flags.push("ROE boosted by debt");
  if (eg != null && eg < 0) flags.push("Earnings falling");
  if (rg != null && rg < 0) flags.push("Revenue falling");
  if (pe != null && pe > 60) flags.push("Expensive (P/E > 60)");
  if (pe != null && pe <= 0) flags.push("Loss-making");
  // Glossary §23 red flags we can detect from the data we have. For banks/NBFCs operating cash
  // flow swings with lending and deposits, so it is not a meaningful warning there.
  if (!financial && f.operatingCashFlowCr != null && f.operatingCashFlowCr < 0) flags.push("Negative operating cash flow");
  if (!financial && f.freeCashFlowCr != null && f.freeCashFlowCr < 0) flags.push("Negative free cash flow");
  if (f.bookValuePerShare != null && f.bookValuePerShare < 0) flags.push("Negative net worth");
  if (f.fromHigh52 != null && f.fromHigh52 >= -3) flags.push("Near 52W high");
  return { scores: { quality, growth, value, overall }, flags };
}

async function loadOne(symbol: string): Promise<Fundamentals | null> {
  const r = await fetchQuoteSummary(symbol, "price,summaryDetail,defaultKeyStatistics,financialData,assetProfile");
  if (!r) return null;
  const price = rec(r.price) ?? {};
  const sd = rec(r.summaryDetail) ?? {};
  const ks = rec(r.defaultKeyStatistics) ?? {};
  const fd = rec(r.financialData) ?? {};
  const ap = rec(r.assetProfile) ?? {};
  const last = raw(price.regularMarketPrice) ?? raw(fd.currentPrice);
  const high = raw(sd.fiftyTwoWeekHigh);
  const mcap = raw(price.marketCap) ?? raw(sd.marketCap);
  const sector = SECTOR_OF.get(symbol) ?? (typeof ap.sector === "string" ? ap.sector : "Other");

  const base = {
    symbol,
    name: String(price.longName ?? price.shortName ?? symbol),
    sector,
    industry: typeof ap.industry === "string" ? ap.industry : null,
    price: round(last),
    marketCapCr: mcap != null ? Math.round(mcap / 1e7) : null, // ₹ crore
    pe: round(raw(sd.trailingPE) ?? raw(ks.trailingPE), 1),
    pb: round(raw(ks.priceToBook), 2),
    roe: pct(raw(fd.returnOnEquity)),
    roa: pct(raw(fd.returnOnAssets)),
    debtToEquity: (() => {
      const v = raw(fd.debtToEquity); // Yahoo reports this as a percentage
      return v == null ? null : round(v / 100, 2);
    })(),
    revenueGrowth: pct(raw(fd.revenueGrowth)),
    earningsGrowth: pct(raw(fd.earningsGrowth)),
    operatingMargin: pct(raw(fd.operatingMargins)),
    netMargin: pct(raw(fd.profitMargins)),
    dividendYield: pct(raw(sd.dividendYield)),
    currentRatio: round(raw(fd.currentRatio), 2),
    insiderHolding: pct(raw(ks.heldPercentInsiders)),
    operatingCashFlowCr: (() => { const v = raw(fd.operatingCashflow); return v == null ? null : Math.round(v / 1e7); })(),
    freeCashFlowCr: (() => { const v = raw(fd.freeCashflow); return v == null ? null : Math.round(v / 1e7); })(),
    bookValuePerShare: round(raw(ks.bookValue), 2),
    fromHigh52: last != null && high ? round(((last - high) / high) * 100, 1) : null,
  };
  // Banks/NBFCs: our sector map says "Banking"/"Finance"; Yahoo says "Financial Services" (e.g. Shriram Finance).
  const financial = FINANCIAL_SECTORS.has(sector) || ap.sector === "Financial Services";
  return { ...base, ...scoreStock(base, financial) };
}

async function crawlAll(): Promise<FundamentalsSnapshot> {
  const symbols = getAllStocks();
  const stocks: Fundamentals[] = [];
  const failed: string[] = [];
  let next = 0;
  // 4 at a time with a short pause: gentle on Yahoo, ~15 s for the whole universe.
  const worker = async () => {
    while (next < symbols.length) {
      const s = symbols[next++];
      try {
        const f = await loadOne(s);
        if (f) stocks.push(f);
        else failed.push(s);
      } catch {
        failed.push(s);
      }
      await new Promise((r) => setTimeout(r, 150));
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  stocks.sort((a, b) => b.scores.overall - a.scores.overall);
  return { stocks, failed, fetchedAt: new Date().toISOString() };
}

// Fundamentals change quarterly; refresh every 6 hours.
const FRESH_MS = 6 * 60 * 60 * 1000;
let snapshot: { at: number; data: FundamentalsSnapshot } | null = null;
let inflight: Promise<FundamentalsSnapshot> | null = null;

export async function getFundamentals(): Promise<FundamentalsSnapshot> {
  const refresh = () =>
    (inflight ??= crawlAll()
      .then((data) => {
        if (data.stocks.length) snapshot = { at: Date.now(), data };
        return data;
      })
      .finally(() => (inflight = null)));
  if (snapshot && Date.now() - snapshot.at < FRESH_MS) return snapshot.data;
  if (snapshot) {
    void refresh().catch(() => undefined);
    return snapshot.data;
  }
  return refresh();
}
