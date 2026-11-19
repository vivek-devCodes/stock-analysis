// End-of-day derivatives analytics from NSE's F&O bhavcopy: the same numbers the NSE Option Chain,
// Change in Open Interest and Most Active Contracts pages show, computed from the official file.
// Pure; covered by src/scripts/test-exchange.ts.

import { greeks } from "./greeks";
import type { FoRow } from "./parse";
import type { Buildup, FnoSummary } from "./types";

/** Annual risk-free rate used for Greeks (≈ 91-day T-bill). */
export const RISK_FREE = 0.065;

const dayMs = 86_400_000;
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / dayMs);

/** Price up/down × OI up/down → the four classic build-ups. Tiny moves are not classified. */
export function classifyBuildup(priceChangePct: number | null, oiChangePct: number | null): Buildup | null {
  if (priceChangePct == null || oiChangePct == null) return null;
  if (Math.abs(oiChangePct) < 1 || Math.abs(priceChangePct) < 0.1) return null;
  if (priceChangePct > 0) return oiChangePct > 0 ? "long build-up" : "short covering";
  return oiChangePct > 0 ? "short build-up" : "long unwinding";
}

/** Strike at which option buyers' total payoff (writers' loss) is smallest. */
export function maxPain(chain: Array<{ strike: number; callOi: number; putOi: number }>): number | null {
  if (!chain.length) return null;
  let best: number | null = null;
  let bestPain = Infinity;
  for (const { strike: k } of chain) {
    let pain = 0;
    for (const c of chain) {
      if (k > c.strike) pain += c.callOi * (k - c.strike);
      if (k < c.strike) pain += c.putOi * (c.strike - k);
    }
    if (pain < bestPain) {
      bestPain = pain;
      best = k;
    }
  }
  return best;
}

export function buildFnoSummaries(rows: FoRow[], tradeDate: string): Map<string, FnoSummary> {
  const bySymbol = new Map<string, FoRow[]>();
  for (const r of rows) {
    const list = bySymbol.get(r.symbol);
    if (list) list.push(r);
    else bySymbol.set(r.symbol, [r]);
  }
  const out = new Map<string, FnoSummary>();
  for (const [symbol, list] of bySymbol) {
    const s = summarise(list, tradeDate);
    if (s) out.set(symbol, s);
  }
  return out;
}

function summarise(list: FoRow[], tradeDate: string): FnoSummary | null {
  const futures = list.filter((r) => r.type.endsWith("F") && r.expiry >= tradeDate).sort((a, b) => a.expiry.localeCompare(b.expiry));
  const options = list.filter((r) => r.type.endsWith("O") && r.optType && r.strike != null && r.expiry >= tradeDate);
  const underlying = list.find((r) => r.underlying != null && r.underlying > 0)?.underlying ?? null;

  // Futures: near-month price, OI summed across expiries (rollovers move OI between months).
  const near = futures[0] ?? null;
  const futOi = futures.reduce((a, r) => a + r.oi, 0);
  const futChg = futures.reduce((a, r) => a + r.chgOi, 0);
  const futOiChangePct = futOi - futChg > 0 ? (futChg / (futOi - futChg)) * 100 : null;
  const futChangePct = near && near.prevClose > 0 ? ((near.close - near.prevClose) / near.prevClose) * 100 : null;

  // Options: nearest expiry with at least 2 days left (on expiry eve the near chain is thin).
  const expiries = [...new Set(options.map((o) => o.expiry))].sort();
  const expiry = expiries.find((e) => daysBetween(tradeDate, e) >= 2) ?? expiries[0] ?? null;
  if (!near && !expiry) return null;

  const chainMap = new Map<number, { strike: number; callOi: number; putOi: number; callChg: number; putChg: number; ce?: FoRow; pe?: FoRow }>();
  for (const o of options) {
    if (o.expiry !== expiry) continue;
    const k = o.strike!;
    const row = chainMap.get(k) ?? { strike: k, callOi: 0, putOi: 0, callChg: 0, putChg: 0 };
    if (o.optType === "CE") {
      row.callOi += o.oi;
      row.callChg += o.chgOi;
      row.ce = o;
    } else {
      row.putOi += o.oi;
      row.putChg += o.chgOi;
      row.pe = o;
    }
    chainMap.set(k, row);
  }
  const chain = [...chainMap.values()].sort((a, b) => a.strike - b.strike);
  const callOi = chain.reduce((a, c) => a + c.callOi, 0);
  const putOi = chain.reduce((a, c) => a + c.putOi, 0);
  const top = (key: "callOi" | "putOi") => (chain.length ? chain.reduce((m, c) => (c[key] > m[key] ? c : m)).strike : null);

  const spot = underlying ?? near?.close ?? null;
  const atm = spot != null && chain.length ? chain.reduce((m, c) => (Math.abs(c.strike - spot) < Math.abs(m.strike - spot) ? c : m)) : null;
  const dte = expiry ? Math.max(daysBetween(tradeDate, expiry), 0) : 0;
  const years = Math.max(dte, 0.5) / 365;
  const g = (o: FoRow | undefined) => (o && spot && o.close > 0 ? greeks({ spot, strike: o.strike!, years, rate: RISK_FREE, type: o.optType! }, o.close) : null);
  const atmCall = g(atm?.ce);
  const atmPut = g(atm?.pe);
  const ivs = [atmCall?.iv, atmPut?.iv].filter((x): x is number => x != null);

  return {
    expiry: expiry ?? near!.expiry,
    daysToExpiry: dte,
    underlying: spot,
    futPrice: near?.close ?? null,
    futChangePct,
    futOi: futures.length ? futOi : null,
    futOiChangePct,
    buildup: classifyBuildup(futChangePct, futOiChangePct),
    basisPct: near && spot ? ((near.close - spot) / spot) * 100 : null,
    callOi,
    putOi,
    callOiChange: chain.reduce((a, c) => a + c.callChg, 0),
    putOiChange: chain.reduce((a, c) => a + c.putChg, 0),
    pcr: callOi > 0 ? putOi / callOi : null,
    maxPain: maxPain(chain),
    resistance: callOi > 0 ? top("callOi") : null,
    support: putOi > 0 ? top("putOi") : null,
    atmStrike: atm?.strike ?? null,
    atmIv: ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null,
    atmCall,
    atmPut,
    contracts: list.reduce((a, r) => a + r.contracts, 0),
    turnoverCr: list.reduce((a, r) => a + r.turnover, 0) / 1e7,
    lotSize: near?.lot ?? options[0]?.lot ?? null,
    chain: [...chain]
      .sort((a, b) => b.callOi + b.putOi - (a.callOi + a.putOi))
      .slice(0, 10)
      .sort((a, b) => a.strike - b.strike)
      .map((c) => [c.strike, c.callOi, c.putOi] as [number, number, number]),
  };
}
