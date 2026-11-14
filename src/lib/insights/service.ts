import "server-only";
import { THRESHOLDS } from "../agents/thresholds";
import { buildInsight } from "../analysis";
import { getFundamentals, getFundamentalsFor } from "../fundamentals";
import { computeIndicators } from "../indicators";
import { SECTORS } from "../stock-universe";
import type { Candle, Quote } from "../types";
import { fetchChart } from "../yahoo";
import { quickVerdict, returnsOf, riskProfile } from "./compute";
import type { Returns, SectorDetailResponse, SectorStock, SectorSummary, SectorsResponse, StockInsight } from "./types";

/* ----------------------------------------- caching ----------------------------------------- */

const TTL_MS = 10 * 60 * 1000;
const chartCache = new Map<string, { at: number; p: Promise<{ quote: Quote; candles: Candle[] }> }>();

/** 1 year of daily candles, cached for 10 minutes and shared by all insight/sector requests. */
function daily1y(symbol: string) {
  const hit = chartCache.get(symbol);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.p;
  const p = fetchChart(symbol, "1y", "1d").then(({ quote, candles }) => ({ quote, candles }));
  p.catch(() => chartCache.delete(symbol));
  chartCache.set(symbol, { at: Date.now(), p });
  return p;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

const SECTOR_OF = new Map<string, string>();
for (const [sector, list] of Object.entries(SECTORS)) for (const s of list) if (!SECTOR_OF.has(s)) SECTOR_OF.set(s, sector);

export const SECTOR_META: Record<string, { label: string; index: string | null }> = {
  Banking: { label: "Banking", index: "^NSEBANK" },
  IT: { label: "Information Technology", index: "^CNXIT" },
  Pharma: { label: "Pharma & Healthcare", index: "^CNXPHARMA" },
  Auto: { label: "Automobile", index: "^CNXAUTO" },
  FMCG: { label: "FMCG / Consumer", index: "^CNXFMCG" },
  Energy: { label: "Energy & Power", index: "^CNXENERGY" },
  Metal: { label: "Metals & Mining", index: "^CNXMETAL" },
  Realty: { label: "Real Estate", index: "^CNXREALTY" },
  Infra: { label: "Infrastructure", index: "^CNXINFRA" },
  Finance: { label: "Financial Services", index: "NIFTY_FIN_SERVICE.NS" },
};

const agentHref = (symbol: string, horizon: "swing" | "long-term" | null) => `/agent?symbol=${encodeURIComponent(symbol)}&horizon=${horizon ?? "swing"}`;

/* ------------------------------------------ per stock ------------------------------------------ */

function buildStock(symbol: string, quote: Quote, candles: Candle[], nifty: Candle[], fScore: number | null, flags: string[]) {
  const risk = riskProfile(candles, nifty, quote.price);
  const insight = candles.length >= 60 ? buildInsight(quote, candles.slice(-300), computeIndicators(candles.slice(-300)), []) : null;
  const verdict = quickVerdict({ daily: candles, insight, fundamentalScore: fScore, flags, risk });
  return { risk, verdict };
}

const insightCache = new Map<string, { at: number; p: Promise<StockInsight> }>();

export function getStockInsight(symbol: string): Promise<StockInsight> {
  const hit = insightCache.get(symbol);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.p;
  const p = (async () => {
    const [{ quote, candles }, nifty, f] = await Promise.all([daily1y(symbol), daily1y("^NSEI").catch(() => ({ candles: [] as Candle[] })), getFundamentalsFor(symbol).catch(() => null)]);
    const { risk, verdict } = buildStock(symbol, quote, candles, nifty.candles, f?.scores.overall ?? null, f?.flags ?? []);
    return {
      symbol,
      name: quote.name,
      sector: SECTOR_OF.get(symbol) ?? f?.sector ?? "—",
      price: quote.price,
      asOf: candles.length ? new Date(candles.at(-1)!.time * 1000).toISOString() : new Date().toISOString(),
      verdict,
      risk,
      agentHref: agentHref(symbol, verdict.horizonHint),
    } satisfies StockInsight;
  })();
  p.catch(() => insightCache.delete(symbol));
  insightCache.set(symbol, { at: Date.now(), p });
  return p;
}

/* ------------------------------------------- sectors ------------------------------------------- */

type SectorData = { asOf: string; summaries: SectorSummary[]; stocks: Map<string, SectorStock[]>; notes: string[] };
let sectorCache: { at: number; p: Promise<SectorData> } | null = null;

const avgOf = (xs: Array<number | null>) => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const shareUp = (xs: Array<number | null>) => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.filter((x) => x > 0).length / v.length : null;
};

async function computeSectors(): Promise<SectorData> {
  const notes: string[] = [];
  const keys = Object.keys(SECTORS);
  const symbols = [...new Set(Object.values(SECTORS).flat())];
  const [nifty, fund] = await Promise.all([daily1y("^NSEI").catch(() => null), getFundamentals().catch(() => null)]);
  const fundBy = new Map((fund?.stocks ?? []).map((f) => [f.symbol, f]));
  if (!fund) notes.push("Fundamentals unavailable right now — verdicts use trend and risk only.");

  const charts = new Map<string, { quote: Quote; candles: Candle[] }>();
  await mapLimit([...symbols, ...keys.map((k) => SECTOR_META[k]?.index).filter((x): x is string => !!x)], 6, async (s) => {
    try {
      charts.set(s, await daily1y(s));
    } catch {
      notes.push(`No data for ${s}.`);
    }
  });

  const stocksBy = new Map<string, SectorStock[]>();
  const summaries: SectorSummary[] = [];
  for (const key of keys) {
    const rows: SectorStock[] = [];
    let upVol = 0;
    let downVol = 0;
    const breadth = { up: 0, down: 0, flat: 0 };
    for (const s of SECTORS[key as keyof typeof SECTORS]) {
      const c = charts.get(s);
      if (!c || c.candles.length < 30) continue;
      const f = fundBy.get(s) ?? null;
      const { risk, verdict } = buildStock(s, c.quote, c.candles, nifty?.candles ?? [], f?.scores.overall ?? null, f?.flags ?? []);
      const returns = returnsOf(c.candles);
      rows.push({ symbol: s, name: c.quote.name, price: c.quote.price, returns, fundamentalScore: f?.scores.overall ?? null, verdict, risk, agentHref: agentHref(s, verdict.horizonHint) });
      if (returns.d1 == null || Math.abs(returns.d1) < 0.0005) breadth.flat += 1;
      else if (returns.d1 > 0) breadth.up += 1;
      else breadth.down += 1;
      // Price-volume pressure proxy: volume on up days vs down days over the last 20 sessions.
      const last = c.candles.slice(-21);
      for (let i = 1; i < last.length; i += 1) {
        if (last[i].close > last[i - 1].close) upVol += last[i].volume * last[i].close;
        else if (last[i].close < last[i - 1].close) downVol += last[i].volume * last[i].close;
      }
    }
    const idxSym = SECTOR_META[key]?.index ?? null;
    const idx = idxSym ? charts.get(idxSym) : undefined;
    const pick = (k: keyof Returns) => rows.map((r) => r.returns[k]);
    const ratio = downVol > 0 ? upVol / downVol : null;
    summaries.push({
      sector: key,
      label: SECTOR_META[key]?.label ?? key,
      indexSymbol: idxSym,
      index: idx && idx.candles.length > 63 ? returnsOf(idx.candles) : null,
      avg: { d1: avgOf(pick("d1")), m1: avgOf(pick("m1")), m2: avgOf(pick("m2")), m3: avgOf(pick("m3")) },
      profitableShare: { d1: shareUp(pick("d1")), m1: shareUp(pick("m1")), m2: shareUp(pick("m2")), m3: shareUp(pick("m3")) },
      breadthToday: breadth,
      upDownVolumeRatio: ratio,
      pressure: ratio == null ? "neutral" : ratio >= THRESHOLDS.sector.buyingRatio ? "buying" : ratio <= THRESHOLDS.sector.sellingRatio ? "selling" : "neutral",
      stocks: rows.length,
    });
    stocksBy.set(key, rows.sort((a, b) => (b.returns.m1 ?? -9) - (a.returns.m1 ?? -9)));
  }
  notes.push(
    "Buying / selling pressure is a price-volume proxy (traded value on up days vs down days over 20 sessions), not actual FII/DII flow data.",
    "Sector averages are equal-weighted over the stocks Apex Desk tracks in that sector; index returns come from the NSE sector index.",
    "Stock verdicts are screening views; open the full agent analysis for a validated decision with risk sizing.",
  );
  return { asOf: new Date().toISOString(), summaries, stocks: stocksBy, notes };
}

function sectorData() {
  if (!sectorCache || Date.now() - sectorCache.at > TTL_MS) {
    const p = computeSectors();
    p.catch(() => (sectorCache = null));
    sectorCache = { at: Date.now(), p };
  }
  return sectorCache.p;
}

export async function getSectors(): Promise<SectorsResponse> {
  const d = await sectorData();
  return { asOf: d.asOf, sectors: d.summaries, notes: d.notes };
}

export async function getSectorDetail(key: string): Promise<SectorDetailResponse | null> {
  const d = await sectorData();
  const sector = d.summaries.find((s) => s.sector.toLowerCase() === key.toLowerCase());
  if (!sector) return null;
  return { asOf: d.asOf, sector, stocks: d.stocks.get(sector.sector) ?? [], notes: d.notes };
}
