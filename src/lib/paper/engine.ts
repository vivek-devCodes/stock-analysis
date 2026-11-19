import "server-only";
import { runAnalysis } from "../agents/graph";
import { mapLimit, shortlist } from "../agents/scan";
import type { AnalysisReport } from "../agents/types";
import { getLiveQuotes } from "../live";
import { fetchChart } from "../yahoo";
import { executePendingPlan } from "./plan";
import { latestPlan, listDailyReports } from "./plan-store";
import { istDate, marketPhase, PAPER_SETTINGS, PHASE_LABEL, pnl, replayTrade } from "./rules";
import { autoRanOn, claimAutoRun, insertTrade, isPersisted, listTrades, openTrades, releaseAutoRun, saveAutoRun, symbolsTradedOn, updateTrade } from "./store";
import type { MarketPhase, PaperKind, PaperRunResult, PaperSnapshot, PaperTrade, PaperTradeView } from "./types";

/**
 * Intraday paper trading driven by the AI Analyst.
 *
 *  1. The intraday scanner shortlists the strongest setups; the full multi-agent pipeline
 *     (market, technical, fundamental, news, quant, risk, validator) decides each one.
 *  2. Every BUY / SELL / WATCHLIST call is entered immediately at the live price with the agent's
 *     own stop and first target. Directional setups the agent REJECTED are paper-traded as
 *     "shadow" trades, so we can measure whether saying NO TRADE was right.
 *  3. Open trades are settled by replaying 5-minute candles: target, stop, or square-off at 15:15.
 */

const nowS = () => Math.floor(Date.now() / 1000);

/** Clock phase, downgraded to "closed" on exchange holidays (NIFTY not in its regular session). */
async function livePhase(): Promise<MarketPhase> {
  const phase = marketPhase(nowS());
  if (phase === "weekend" || phase === "pre-open" || phase === "closed") return phase;
  const nifty = (await getLiveQuotes(["^NSEI"]).catch(() => []))[0];
  if (nifty && nifty.marketState && nifty.marketState !== "REGULAR") return "closed";
  return phase;
}

function toTrade(r: AnalysisReport, trigger: "auto" | "manual", day: string): { trade: PaperTrade } | { reason: string } {
  const plan = r.risk.plan;
  if (r.validation === "INSUFFICIENT DATA") return { reason: "Insufficient data" };
  if (!plan) return { reason: `${r.decision} — no directional plan` };
  const kind: PaperKind = r.decision === "BUY" || r.decision === "SELL" || r.decision === "WATCHLIST" ? "recommended" : "shadow";
  const side = plan.direction;
  const entry = r.price.value ?? (side === "long" ? plan.entryHigh : plan.entryLow);
  const target = plan.targets[0];
  const stop = plan.stop;
  const sane = side === "long" ? stop < entry && entry < target : target < entry && entry < stop;
  if (!sane || !Number.isFinite(entry) || entry <= 0) return { reason: "Price already beyond the stop or target" };
  const qty = plan.quantity > 0 ? plan.quantity : Math.floor(PAPER_SETTINGS.capital / entry);
  if (qty < 1) return { reason: "Position size below one share" };

  const tech = r.agents.find((a) => a.agent === "technical");
  const failed = r.validator.checks.filter((c) => c.status === "fail").map((c) => `${c.name}: ${c.detail}`);
  const reasons = [r.headline, tech?.summary, ...(kind === "shadow" ? failed.slice(0, 2).map((f) => `Rejected — ${f}`) : [])].filter(Boolean) as string[];

  return {
    trade: {
      id: `PT-${day.replace(/-/g, "")}-${r.instrument.symbol.replace(/[^A-Z0-9]/gi, "")}`,
      tradeDay: day,
      symbol: r.instrument.symbol,
      name: r.instrument.name,
      // Stamp the trade at the quote's own time (Yahoo can lag ~15 min), so settlement replays every
      // candle after the price we actually entered at — otherwise an early stop-out could be missed.
      openedAt: r.price.timestamp ?? new Date().toISOString(),
      trigger,
      kind,
      side,
      decision: r.decision,
      validation: r.validation,
      score: r.score.total,
      entry,
      target,
      stop,
      qty,
      riskReward: plan.riskReward,
      reasons,
      votes: r.agents.map((a) => ({ agent: a.agent, bias: a.bias, score: a.score })),
      reportId: r.id,
      status: "open",
      exitPrice: null,
      exitAt: null,
      grossPnl: null,
      costs: null,
      netPnl: null,
      returnPct: null,
    },
  };
}

/** Run the agent once and enter its intraday calls. `auto` runs at most once per IST day. */
export async function runPaperAgent(trigger: "auto" | "manual"): Promise<PaperRunResult> {
  const day = istDate(nowS());
  const phase = await livePhase();
  const result: PaperRunResult = { at: new Date().toISOString(), trigger, phase, skipped: null, shortlisted: [], analysed: 0, opened: [], notTraded: [], errors: [] };

  if (phase !== "open") {
    result.skipped = PHASE_LABEL[phase];
    return result;
  }
  // First task of the session: last night's plan (runs once per plan, whoever gets here first).
  result.plan = await executePendingPlan().catch((e) => {
    result.errors.push(`Plan execution: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  });
  if (trigger === "auto" && !(await claimAutoRun(day))) {
    result.skipped = "The automatic run already happened today.";
    return result;
  }

  try {
    const already = await symbolsTradedOn(day);
    const { symbols } = await shortlist("intraday");
    result.shortlisted = symbols;
    const fresh = symbols.filter((s) => !already.has(s));
    for (const s of symbols.filter((x) => already.has(x))) result.notTraded.push({ symbol: s, reason: "Already traded today" });
    if (!symbols.length) result.skipped = "The intraday scanner found no directional setups right now.";

    const reports = await mapLimit(fresh, 2, (s) =>
      runAnalysis({ symbol: s, horizon: "intraday" }).catch((e) => {
        result.errors.push(`${s}: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      }),
    );
    for (const r of reports) {
      if (!r) continue;
      result.analysed += 1;
      const t = toTrade(r, trigger, day);
      if ("reason" in t) {
        result.notTraded.push({ symbol: r.instrument.symbol, reason: t.reason });
        continue;
      }
      if (await insertTrade(t.trade)) result.opened.push({ symbol: t.trade.symbol, kind: t.trade.kind, side: t.trade.side, decision: t.trade.decision });
      else result.notTraded.push({ symbol: t.trade.symbol, reason: "Already traded today" });
    }
  } catch (e) {
    result.errors.push(e instanceof Error ? e.message : String(e));
    if (trigger === "auto" && result.analysed === 0) await releaseAutoRun(day).catch(() => undefined);
    return result;
  }
  if (trigger === "auto") {
    // Nothing entered: give the day back so a later automatic run (page auto mode) can try again.
    if (result.opened.length === 0) await releaseAutoRun(day).catch(() => undefined);
    else await saveAutoRun(day, result).catch(() => undefined);
  }
  return result;
}

/** Settle open trades from 5-minute candles. Throttled per server instance. */
let lastSettle = 0;
export async function settleOpenTrades(force = false): Promise<{ checked: number; closed: number; errors: string[] }> {
  if (!force && Date.now() - lastSettle < 60_000) return { checked: 0, closed: 0, errors: [] };
  lastSettle = Date.now();
  const open = await openTrades();
  const errors: string[] = [];
  let closed = 0;
  const bySymbol = new Map<string, PaperTrade[]>();
  for (const t of open) bySymbol.set(t.symbol, [...(bySymbol.get(t.symbol) ?? []), t]);

  await mapLimit([...bySymbol.entries()], 4, async ([symbol, trades]) => {
    let candles;
    try {
      candles = (await fetchChart(symbol, "5d", "5m")).candles;
    } catch (e) {
      errors.push(`${symbol}: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    for (const t of trades) {
      const res = replayTrade({ side: t.side, entry: t.entry, target: t.target, stop: t.stop, openedAt: Math.floor(Date.parse(t.openedAt) / 1000) }, candles, nowS());
      if (!res) continue;
      const p = pnl(t.side, t.entry, res.exitPrice, t.qty);
      await updateTrade({
        ...t,
        status: res.status,
        exitPrice: res.exitPrice,
        exitAt: new Date(res.exitAt * 1000).toISOString(),
        grossPnl: p.gross,
        costs: p.costs,
        netPnl: p.net,
        returnPct: p.returnPct,
      });
      closed += 1;
    }
  });
  return { checked: open.length, closed, errors };
}

/** Everything the Paper Trading page needs: trades with live marks, plus market status. */
export async function paperSnapshot(): Promise<PaperSnapshot> {
  await settleOpenTrades().catch((e) => console.error("[paper] settle failed:", e));
  const [trades, persisted, phase, plan, reports] = await Promise.all([listTrades(), isPersisted(), livePhase(), latestPlan().catch(() => null), listDailyReports(10).catch(() => [])]);
  const today = istDate(nowS());
  const openSymbols = [...new Set(trades.filter((t) => t.status === "open").map((t) => t.symbol))];
  const quotes = openSymbols.length ? await getLiveQuotes(openSymbols).catch(() => []) : [];
  const price = new Map(quotes.map((q) => [q.symbol, q.price]));

  const views: PaperTradeView[] = trades.map((t) => {
    const last = t.status === "open" ? price.get(t.symbol) ?? null : null;
    return { ...t, lastPrice: last, unrealizedPnl: last != null ? pnl(t.side, t.entry, last, t.qty).net : null };
  });

  return {
    persisted,
    note: persisted ? null : "No DATABASE_URL — paper trades are kept in this server's memory only and are lost on restart or redeploy. Connect Postgres to keep the track record.",
    phase,
    phaseLabel: PHASE_LABEL[phase],
    today,
    autoRanToday: await autoRanOn(today),
    trades: views,
    plan,
    reports,
    settings: PAPER_SETTINGS,
  };
}
