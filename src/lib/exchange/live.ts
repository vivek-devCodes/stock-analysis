import "server-only";
import { callTool } from "../nse-live";
import type { ListRow } from "./types";

/**
 * Intraday market movers from NSE's official live market server (mcp.nseindia.in — free, no key,
 * ~1–5 minute refresh). Outside market hours it returns the last session's final movers.
 */

export type LiveMovers = { updatedAt: string | null; gainers: ListRow[]; losers: ListRow[]; source: string };

const CACHE_MS = 60_000;
let cache: { at: number; value: LiveMovers } | null = null;

const amount = (v: unknown): number => {
  if (typeof v === "number") return v;
  const m = String(v ?? "").match(/([\d.]+)\s*(Cr|L|K)?/i);
  if (!m) return 0;
  const x = Number(m[1]);
  const unit = (m[2] ?? "").toUpperCase();
  return unit === "CR" ? x * 1e7 : unit === "L" ? x * 1e5 : unit === "K" ? x * 1e3 : x;
};

function rows(list: unknown): ListRow[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((r: Record<string, unknown>) => ({
      symbol: String(r.symbol ?? ""),
      close: Number(r.ltp ?? 0),
      changePct: Number(r.perChange ?? r.net_price ?? 0),
      value: amount(r.turnover) / 1e7,
      note: `₹${(amount(r.turnover) / 1e7).toFixed(1)} cr traded`,
    }))
    .filter((r) => r.symbol && r.close > 0);
}

export async function getLiveMovers(limit = 10): Promise<LiveMovers | null> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  try {
    const data = (await callTool("nse_get_market_movers", { indexName: "", limit })) as Record<string, unknown>;
    const value: LiveMovers = {
      updatedAt: String(data.gainersUpdatedAt ?? data.losersUpdatedAt ?? "") || null,
      gainers: rows(data.gainers),
      losers: rows(data.losers),
      source: "NSE live market server (nse_get_market_movers)",
    };
    cache = { at: Date.now(), value };
    return value;
  } catch {
    return null;
  }
}
