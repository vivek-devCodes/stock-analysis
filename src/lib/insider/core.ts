/**
 * Insider-trading strategy (SEBI PIT Regulation 7 disclosures published by NSE).
 *
 * Idea: promoters, directors and key managers who BUY their own company's shares in the open
 * market are betting their own money on it. Each week's disclosures are filtered to those real
 * market purchases (and sales), scored per stock, and then checked on the daily chart (price
 * action / levels) before anything is suggested. Pure functions; fetching lives in fetch.ts.
 */

export type InsiderTxn = {
  appId: string;
  symbol: string;
  company: string;
  person: string;
  /** As filed: Promoters, Promoter Group, Director, Key Managerial Personnel, Designated Person, Employees, Other… */
  category: string;
  type: "Buy" | "Sell" | "Other";
  /** As filed: Market Purchase, Market Sale, ESOP, Inter-se Transfer, Gift, Pledge… */
  mode: string;
  qty: number;
  value: number;
  prePct: number | null;
  postPct: number | null;
  fromDate: string | null;
  toDate: string | null;
  intimationDate: string | null;
  disclosedAt: string;
  exchange: string | null;
};

const tag = (block: string, name: string) => {
  const m = new RegExp(`<in-bse-co:${name}(?:\\s[^>]*)?>([^<]*)</in-bse-co:${name}>`).exec(block);
  return m ? m[1].replace(/\s+/g, " ").trim() : null;
};
const num = (s: string | null) => {
  if (s == null || s === "" || s === "NA") return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** Parse one NSE PIT XBRL file into its individual transactions (one per Disclosure context). */
export function parseDisclosureXml(xml: string, meta: { appId: string; symbol: string; company: string; disclosedAt: string }): InsiderTxn[] {
  const byCtx = new Map<string, string[]>();
  const re = /<in-bse-co:([A-Za-z]+)\s+contextRef="([^"]+)"[^>]*>([^<]*)<\/in-bse-co:\1>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    if (!/^Disclosure/i.test(m[2])) continue;
    const list = byCtx.get(m[2]) ?? [];
    list.push(`<in-bse-co:${m[1]}>${m[3]}</in-bse-co:${m[1]}>`);
    byCtx.set(m[2], list);
  }
  const symbol = tag(xml, "Symbol") ?? meta.symbol;
  const company = tag(xml, "NameOfTheCompany") ?? meta.company;
  // NSE's XBRL files percentages as fractions ("pure": 0.0016 = 0.16%); a few filers write 0.16. Treat
  // a pair where both values are ≤ 1 as fractions.
  const pctPair = (pre: number | null, post: number | null): [number | null, number | null] =>
    pre != null && post != null && pre <= 1 && post <= 1 ? [pre * 100, post * 100] : [pre, post];
  const out: InsiderTxn[] = [];
  for (const parts of byCtx.values()) {
    const b = parts.join("");
    const type = (tag(b, "SecuritiesAcquiredOrDisposedTransactionType") ?? "").toLowerCase();
    const instrument = (tag(b, "TypeOfInstrument") ?? "Equity").toLowerCase();
    if (instrument && !instrument.includes("equity") && !instrument.includes("share")) continue;
    out.push({
      appId: meta.appId,
      symbol,
      company,
      person: tag(b, "NameOfThePerson") ?? "—",
      category: tag(b, "CategoryOfPerson") ?? "Other",
      type: type.startsWith("buy") || type.includes("acqui") ? "Buy" : type.startsWith("sell") || type.includes("dispos") ? "Sell" : "Other",
      mode: tag(b, "ModeOfAcquisitionOrDisposal") ?? "—",
      qty: num(tag(b, "SecuritiesAcquiredOrDisposedNumberOfSecurity")) ?? 0,
      value: num(tag(b, "SecuritiesAcquiredOrDisposedValueOfSecurity")) ?? 0,
      ...(() => {
        const [prePct, postPct] = pctPair(num(tag(b, "SecuritiesHeldPriorToAcquisitionOrDisposalPercentageOfShareholding")), num(tag(b, "SecuritiesHeldPostAcquistionOrDisposalPercentageOfShareholding")));
        return { prePct, postPct };
      })(),
      fromDate: tag(b, "DateOfAllotmentAdviceOrAcquisitionOfSharesOrSaleOfSharesSpecifyFromDate"),
      toDate: tag(b, "DateOfAllotmentAdviceOrAcquisitionOfSharesOrSaleOfSharesSpecifyToDate"),
      intimationDate: tag(b, "DateOfIntimationToCompany"),
      disclosedAt: meta.disclosedAt,
      exchange: tag(b, "ExchangeOnWhichTheTradeWasExecuted"),
    });
  }
  return out;
}

/* --------------------------------------------- what counts --------------------------------------------- */

const INSIDER_CATEGORIES = [/promoter/i, /director/i, /key\s*manag/i, /\bkmp\b/i, /chief|ceo|cfo|managing/i];
const MARKET_MODE = /market\s*(purchase|sale|buy|sell)|open\s*market|block\s*deal/i;

/** Who counts: promoters, promoter group, directors and key managers — not ESOP trusts, employees or "Other". */
export const isInsider = (t: Pick<InsiderTxn, "category">) => INSIDER_CATEGORIES.some((r) => r.test(t.category));
/** What counts: an open-market purchase or sale (not ESOP, allotment, gift, pledge, inter-se transfer). */
export const isMarketTrade = (t: Pick<InsiderTxn, "mode">) => MARKET_MODE.test(t.mode);

export const qualifies = (t: InsiderTxn) => t.type !== "Other" && t.value > 0 && isInsider(t) && isMarketTrade(t);

/* --------------------------------------------- per stock --------------------------------------------- */

export type InsiderStock = {
  symbol: string;
  company: string;
  buyValue: number;
  sellValue: number;
  netValue: number;
  buyers: number;
  sellers: number;
  /** Sum of stake added by buyers, percentage points. */
  stakeAddedPct: number;
  promoterBuy: boolean;
  categories: string[];
  people: Array<{ person: string; category: string; type: "Buy" | "Sell"; value: number; date: string | null }>;
  lastTradeDate: string | null;
  lastDisclosed: string;
  /** 0–100: how strong the insider signal is on its own. */
  insiderScore: number;
  direction: "buying" | "selling";
};

const day = (s: string | null | undefined) => (s ? s.slice(0, 10) : null);

/** Aggregate qualifying trades per stock. */
export function aggregate(txns: InsiderTxn[]): InsiderStock[] {
  const by = new Map<string, InsiderTxn[]>();
  for (const t of txns.filter(qualifies)) by.set(t.symbol, [...(by.get(t.symbol) ?? []), t]);
  const out: InsiderStock[] = [];
  for (const [symbol, list] of by) {
    const buys = list.filter((t) => t.type === "Buy");
    const sells = list.filter((t) => t.type === "Sell");
    const buyValue = buys.reduce((s, t) => s + t.value, 0);
    const sellValue = sells.reduce((s, t) => s + t.value, 0);
    const buyers = new Set(buys.map((t) => t.person.toLowerCase())).size;
    const sellers = new Set(sells.map((t) => t.person.toLowerCase())).size;
    const stakeAddedPct = buys.reduce((s, t) => s + (t.postPct != null && t.prePct != null ? Math.max(0, t.postPct - t.prePct) : 0), 0);
    const netValue = buyValue - sellValue;
    const promoterBuy = buys.some((t) => /promoter/i.test(t.category));
    const lastTradeDate = list.map((t) => day(t.toDate ?? t.fromDate)).filter((x): x is string => Boolean(x)).sort().at(-1) ?? null;
    const lastDisclosed = list.map((t) => t.disclosedAt).sort().at(-1)!;
    out.push({
      symbol,
      company: list[0].company,
      buyValue,
      sellValue,
      netValue,
      buyers,
      sellers,
      stakeAddedPct,
      promoterBuy,
      categories: [...new Set(list.map((t) => t.category))],
      people: list.map((t) => ({ person: t.person, category: t.category, type: t.type as "Buy" | "Sell", value: t.value, date: day(t.toDate ?? t.fromDate) })),
      lastTradeDate,
      lastDisclosed,
      insiderScore: 0,
      direction: netValue >= 0 ? "buying" : "selling",
    });
  }
  return out.map((s) => ({ ...s, insiderScore: insiderScore(s) })).sort((a, b) => b.insiderScore - a.insiderScore || b.netValue - a.netValue);
}

/**
 * 0–100 strength of the insider signal: size of net buying (log-scaled, ₹10 lakh → ₹10 crore),
 * number of different insiders, promoter vs director, stake added. Net sellers score 0.
 */
export function insiderScore(s: Pick<InsiderStock, "netValue" | "buyers" | "sellers" | "promoterBuy" | "stakeAddedPct">): number {
  if (s.netValue <= 0) return 0;
  const lakh = s.netValue / 1e5;
  const size = Math.max(0, Math.min(1, Math.log10(Math.max(lakh, 1)) / 3)); // ₹1 L → 0, ₹10 cr → 1
  const breadth = Math.min(1, (s.buyers - 1) / 3); // 1 buyer → 0, 4+ → 1
  const stake = Math.min(1, s.stakeAddedPct / 0.5); // 0.5 pp+ → 1
  const raw = 45 * size + 20 * breadth + 15 * stake + (s.promoterBuy ? 15 : 5) - (s.sellers > 0 ? 10 : 0);
  return Math.round(Math.max(0, Math.min(100, raw)));
}

/* --------------------------------------------- chart check --------------------------------------------- */

export type ChartVerdict = "ready" | "wait" | "avoid" | "no-data";

export const VERDICT_TEXT: Record<ChartVerdict, string> = {
  ready: "Setup ready",
  wait: "Wait for breakout",
  avoid: "Avoid — chart against it",
  "no-data": "No chart data",
};

/**
 * Daily price action for an insider-buying stock (the second half of the strategy):
 *  ready — bullish structure or holding support, with room (≥ 1 ATR) to the next resistance;
 *  wait  — insiders buying but price is right under resistance or structure is unclear;
 *  avoid — bearish structure / below a falling 200-day average.
 */
export function chartVerdict(input: {
  structure: "bullish" | "bearish" | "range";
  toResistanceAtr: number | null;
  toSupportAtr: number | null;
  belowFalling200: boolean;
  bullishPattern: boolean;
}): { verdict: ChartVerdict; score: number; reasons: string[] } {
  const reasons: string[] = [];
  if (input.belowFalling200 && input.structure === "bearish") {
    reasons.push("Below a falling 200-day average with bearish structure");
    return { verdict: "avoid", score: 10, reasons };
  }
  if (input.structure === "bearish") {
    reasons.push("Bearish market structure (lower highs and lows)");
    return { verdict: "avoid", score: 25, reasons };
  }
  let score = 50;
  if (input.structure === "bullish") {
    score += 20;
    reasons.push("Bullish structure (higher highs and lows)");
  }
  const room = input.toResistanceAtr;
  if (room != null && room < 0.75) {
    reasons.push(`Only ${room.toFixed(1)} ATR under resistance — wait for a close above it`);
    return { verdict: "wait", score: Math.min(score, 55), reasons };
  }
  if (room == null || room >= 1) {
    score += 10;
    reasons.push(room == null ? "No resistance overhead (at highs)" : `${room.toFixed(1)} ATR of room to resistance`);
  }
  if (input.toSupportAtr != null && input.toSupportAtr <= 1) {
    score += 10;
    reasons.push(`Close to support (${input.toSupportAtr.toFixed(1)} ATR) — tight stop possible`);
  }
  if (input.bullishPattern) {
    score += 10;
    reasons.push("Bullish candle pattern on the last day");
  }
  return { verdict: input.structure === "bullish" || input.bullishPattern || (input.toSupportAtr ?? 9) <= 1 ? "ready" : "wait", score: Math.min(100, score), reasons };
}

/** Final rank: insider strength and chart quality together. */
export const combinedScore = (insider: number, chart: number) => Math.round(0.6 * insider + 0.4 * chart);
