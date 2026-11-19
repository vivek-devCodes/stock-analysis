import "server-only";
import { getMarketDay } from "../exchange/store";
import { fetchChart } from "../yahoo";
import { assessRegime, type Regime } from "./regime";
import { evaluateGuard, type Guard } from "./risk";
import { istDate, PAPER_SETTINGS } from "./rules";
import { getFlag, listTrades } from "./store";

/** Server side of the risk rules: reads the trades, the regime and the drawdown reset. */

let regimeCache: { at: number; regime: Regime } | null = null;

/** Today's regime: India VIX from the latest NSE indices file, NIFTY trend from daily candles. */
export async function getRegime(): Promise<Regime> {
  if (regimeCache && Date.now() - regimeCache.at < 30 * 60_000) return regimeCache.regime;
  const [market, chart] = await Promise.all([getMarketDay().catch(() => null), fetchChart("^NSEI", "3mo", "1d").catch(() => null)]);
  const vixRow = market?.indices.find((i) => /india vix/i.test(i.name));
  const regime = assessRegime({
    asOf: market?.tradeDate ?? null,
    vix: vixRow?.close ?? null,
    vixChangePct: vixRow?.changePct ?? null,
    niftyCloses: chart?.candles.map((c) => c.close) ?? [],
  });
  regimeCache = { at: Date.now(), regime };
  return regime;
}

export const DRAWDOWN_RESET_FLAG = "drawdown-reset";

/** The guard as of now. Recommended trades only; shadow trades never count toward risk limits. */
export async function currentGuard(withRegime = true): Promise<Guard> {
  const today = istDate(Math.floor(Date.now() / 1000));
  const [trades, reset, regime] = await Promise.all([listTrades(5000), getFlag(DRAWDOWN_RESET_FLAG), withRegime ? getRegime().catch(() => null) : Promise.resolve(null)]);
  const rec = trades.filter((t) => t.kind === "recommended");
  const closed = rec.filter((t) => t.status !== "open" && t.netPnl != null && t.exitAt != null);
  const since = reset?.at ?? "";
  return evaluateGuard({
    capital: PAPER_SETTINGS.capital,
    todayClosedNet: closed.filter((t) => t.tradeDay === today).reduce((a, t) => a + t.netPnl!, 0),
    open: rec.filter((t) => t.status === "open").map((t) => ({ symbol: t.symbol })),
    closedNets: closed
      .filter((t) => t.exitAt! > since)
      .sort((a, b) => a.exitAt!.localeCompare(b.exitAt!))
      .map((t) => t.netPnl!),
    regime,
  });
}
