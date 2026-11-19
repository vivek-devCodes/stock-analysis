// Assembles one trading day from the parsed exchange files: a record per stock and the market-wide
// lists (breadth, gainers, volume gainers, 52-week highs, OI spurts…). Pure; tested.

import { buildFnoSummaries } from "./fno";
import {
  parse52Week,
  parseBan,
  parseBhav,
  parseBseBhav,
  parseDeals,
  parseFoBhav,
  parseIndices,
  parseLots,
  parseParticipants,
  parseSecList,
  parseVolatility,
} from "./parse";
import type { DatasetId, FnoSummary, ListRow, MarketDay, SourceStatus, StockDay } from "./types";

export type History = Map<string, { volumeAvg: number | null; deliveryAvg: number | null; days: number }>;

export const INDEX_UNDERLYINGS = new Set(["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50"]);

const top = <T,>(arr: T[], by: (x: T) => number, k = 15) => [...arr].sort((a, b) => by(b) - by(a)).slice(0, k);

export function assembleDay(
  files: Partial<Record<DatasetId, string>>,
  tradeDate: string,
  sources: SourceStatus[],
  history: History = new Map(),
): { market: MarketDay; stocks: Map<string, StockDay> } {
  const bhav = files.bhav ? parseBhav(files.bhav) : [];
  const sec = files.seclist ? parseSecList(files.seclist) : new Map();
  const ban = new Set(files.ban ? parseBan(files.ban) : []);
  const deals = [...(files.bulk ? parseDeals(files.bulk, "bulk") : []), ...(files.block ? parseDeals(files.block, "block") : [])];
  const wk52 = files.wk52 ? parse52Week(files.wk52) : new Map();
  const lots = files.lots ? parseLots(files.lots) : new Map<string, number>();
  const vol = files.volt ? parseVolatility(files.volt) : new Map<string, number>();
  const bse = files.bse ? parseBseBhav(files.bse) : new Map();
  const fno = files.fo ? buildFnoSummaries(parseFoBhav(files.fo).rows, tradeDate) : new Map<string, FnoSummary>();

  const dealsBy = new Map<string, typeof deals>();
  for (const d of deals) dealsBy.set(d.symbol, [...(dealsBy.get(d.symbol) ?? []), d]);

  const stocks = new Map<string, StockDay>();
  for (const r of bhav) {
    const s = sec.get(r.symbol);
    const band: number | null = s?.band ?? null;
    const changePct = r.prevClose > 0 ? ((r.close - r.prevClose) / r.prevClose) * 100 : 0;
    const bandHit = band != null && Math.abs(changePct) >= band - 0.05 ? (changePct > 0 ? "upper" : "lower") : null;
    const h = history.get(r.symbol);
    const w = wk52.get(r.symbol);
    const f = fno.get(r.symbol) ?? null;
    stocks.set(r.symbol, {
      symbol: r.symbol,
      series: r.series,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      prevClose: r.prevClose,
      changePct,
      volume: r.volume,
      turnoverLacs: r.turnoverLacs,
      trades: r.trades,
      deliveryQty: r.deliveryQty,
      deliveryPct: r.deliveryPct,
      deliveryAvg: h?.deliveryAvg ?? null,
      volumeAvg: h?.volumeAvg ?? null,
      volRatio: h?.volumeAvg ? r.volume / h.volumeAvg : null,
      historyDays: h?.days ?? 0,
      band,
      gsm: s?.gsm ?? null,
      bandHit,
      fnoBan: ban.has(r.symbol),
      inFno: lots.has(r.symbol) || f != null,
      lotSize: lots.get(r.symbol) ?? f?.lotSize ?? null,
      wk52High: w?.high ?? null,
      wk52HighDate: w?.highDate ?? null,
      wk52Low: w?.low ?? null,
      wk52LowDate: w?.lowDate ?? null,
      annualVol: vol.get(r.symbol) ?? null,
      deals: (dealsBy.get(r.symbol) ?? []).map((d) => ({ date: d.date, client: d.client, side: d.side, qty: d.qty, price: d.price, kind: d.kind })),
      fno: f,
      bse: bse.get(r.symbol) ?? null,
    });
  }

  const eq = [...stocks.values()].filter((s) => s.series === "EQ");
  const liquid = eq.filter((s) => s.turnoverLacs >= 100); // ≥ ₹1 crore traded
  const row = (s: StockDay, value: number, note?: string): ListRow => ({ symbol: s.symbol, close: s.close, changePct: s.changePct, value, note });
  const advances = eq.filter((s) => s.changePct > 0).length;
  const declines = eq.filter((s) => s.changePct < 0).length;
  const stockFno = [...fno.entries()].filter(([k]) => !INDEX_UNDERLYINGS.has(k));

  const market: MarketDay = {
    tradeDate,
    builtAt: new Date().toISOString(),
    sources,
    breadth: { advances, declines, unchanged: eq.length - advances - declines, ratio: declines ? advances / declines : null },
    indices: files.indices ? parseIndices(files.indices) : [],
    participants: files.participants ? parseParticipants(files.participants) : [],
    fnoBan: [...ban],
    gsm: [...sec.entries()].filter(([, v]) => v.gsm).map(([symbol, v]) => ({ symbol, stage: v.gsm as string })),
    gainers: top(liquid, (s) => s.changePct).map((s) => row(s, s.changePct)),
    losers: top(liquid, (s) => -s.changePct).map((s) => row(s, s.changePct)),
    mostActive: top(eq, (s) => s.turnoverLacs).map((s) => row(s, s.turnoverLacs / 100, "₹ cr traded")),
    volumeGainers: top(liquid.filter((s) => s.volRatio != null && s.turnoverLacs >= 500), (s) => s.volRatio!).map((s) => row(s, s.volRatio!, "× average volume")),
    highDelivery: top(liquid.filter((s) => s.deliveryPct != null && s.turnoverLacs >= 1000), (s) => s.deliveryPct!).map((s) => row(s, s.deliveryPct!, "% delivered")),
    wk52Highs: top(liquid.filter((s) => s.wk52High != null && s.high >= s.wk52High * 0.999), (s) => s.turnoverLacs, 25).map((s) => row(s, s.wk52High!, "52-week high")),
    wk52Lows: top(liquid.filter((s) => s.wk52Low != null && s.low <= s.wk52Low * 1.001), (s) => s.turnoverLacs, 25).map((s) => row(s, s.wk52Low!, "52-week low")),
    bandHitters: eq.concat([...stocks.values()].filter((s) => s.series !== "EQ")).filter((s) => s.bandHit).slice(0, 40).map((s) => row(s, s.band ?? 0, `${s.bandHit} circuit`)),
    mostActiveUnderlying: top(stockFno, ([, f]) => f.contracts).map(([sym, f]) => ({ symbol: sym, close: f.underlying ?? 0, changePct: f.futChangePct ?? 0, value: f.contracts, note: `contracts · ₹${f.turnoverCr.toFixed(0)} cr` })),
    oiSpurts: top(stockFno.filter(([, f]) => f.futOiChangePct != null), ([, f]) => f.futOiChangePct!).map(([sym, f]) => ({ symbol: sym, close: f.underlying ?? 0, changePct: f.futChangePct ?? 0, value: f.futOiChangePct!, note: f.buildup ?? "OI change" })),
    deals,
    indexFno: Object.fromEntries([...fno.entries()].filter(([k]) => INDEX_UNDERLYINGS.has(k))),
    counts: { equities: stocks.size, fnoUnderlyings: stockFno.length, bse: bse.size },
  };
  return { market, stocks };
}
