import "server-only";
import { THRESHOLDS } from "../agents/thresholds";
import { WEIGHTS } from "../agents/decision";
import { assembleDay } from "../exchange/build";
import { download } from "../exchange/fetch";
import { parseBhav } from "../exchange/parse";
import { loadHistory } from "../exchange/store";
import type { DatasetId, StockDay } from "../exchange/types";
import { currentGuard } from "../paper/guard";
import { planExecutedOn } from "../paper/plan-store";
import { PAPER_SETTINGS } from "../paper/rules";
import { agentAccuracy, groupStats } from "../paper/stats";
import { listTrades } from "../paper/store";
import {
  adaptWeights,
  baselineDay,
  calibrate,
  scoreSignals,
  suggestions,
  summariseBaselines,
  summariseSignals,
  type AdaptedWeights,
  type NextDay,
  type SignalStat,
} from "./core";
import { resetLearnedCache } from "./learned";
import { exchangeDates, getLearned, listBaselineDays, listSignalDays, marketOn, openCloseOn, saveBaselineDay, saveSignalDay, scoredSignalDays, setLearned, stocksOn } from "./store";
import type { ImproveState } from "./improve";

const L = THRESHOLDS.learn;
const MAX_REBUILDS_PER_RUN = 12;

/** A past session rebuilt from NSE's dated archive files (bhavcopy, F&O, 52-week, volatility). */
async function rebuildDay(date: string): Promise<StockDay[]> {
  const files: Partial<Record<DatasetId, string>> = {};
  await Promise.all(
    (["bhav", "fo", "wk52", "volt"] as const).map(async (id) => {
      files[id] = await download(id, date).catch(() => undefined);
    }),
  );
  if (!files.bhav) throw new Error(`No bhavcopy for ${date}`);
  const { stocks } = assembleDay(files, date, [], await loadHistory(date));
  return [...stocks.values()].filter((s) => s.series === "EQ" && s.turnoverLacs >= L.liquidCr * 100);
}

async function openCloseFromArchive(date: string): Promise<Map<string, NextDay>> {
  return new Map(parseBhav(await download("bhav", date)).map((r) => [r.symbol, { open: r.open, close: r.close }]));
}

/**
 * Nightly learning step (after the exchange files are in):
 *   1. score every stored day's NSE signals against the next session (also back-fills history)
 *   2. compare the agent's plan with the baselines for each day it was executed
 *   3. recompute signal multipliers and adaptive agent weights
 */
export async function runLearning(): Promise<{ signalDays: string[]; baselineDays: string[]; weights: AdaptedWeights; muted: string[] }> {
  const dates = await exchangeDates();
  const scored = await scoredSignalDays();
  const signalDays: string[] = [];
  let rebuilt = 0;
  for (let i = dates.length - 2; i >= 0; i--) {
    const d = dates[i];
    const e = dates[i + 1];
    if (scored.has(d.date)) continue;
    try {
      // Recent days are scored from the stored records; older ones are rebuilt from NSE's dated
      // archive files (a few per run, newest first) so the scorecard has evidence from day one.
      let stocks: StockDay[];
      if (d.full) stocks = await stocksOn(d.date, L.liquidCr * 100);
      else if (rebuilt < MAX_REBUILDS_PER_RUN) {
        stocks = await rebuildDay(d.date);
        rebuilt += 1;
      } else continue;
      const next = e.full ? await openCloseOn(e.date) : await openCloseFromArchive(e.date);
      await saveSignalDay(d.date, scoreSignals(d.date, stocks, next));
      signalDays.push(d.date);
    } catch (err) {
      console.error(`[learn] could not score ${d.date}:`, err);
    }
  }

  // Baselines for recent sessions on which a plan was executed.
  const have = new Set((await listBaselineDays(30)).map((b) => b.day));
  const baselineDays: string[] = [];
  const trades = await listTrades(5000);
  for (let i = Math.max(1, dates.length - 10); i < dates.length; i++) {
    const e = dates[i];
    if (have.has(e.date) || !e.full) continue;
    const plan = await planExecutedOn(e.date);
    if (!plan || plan.status === "executing") continue;
    const [prevMarket, next] = await Promise.all([marketOn(dates[i - 1].date), openCloseOn(e.date)]);
    const planTrades = trades.filter((t) => t.tradeDay === e.date && t.trigger === "plan" && t.kind === "recommended" && t.netPnl != null);
    const b = baselineDay({
      day: e.date,
      planItems: plan.items.filter((x) => x.kind === "recommended").map((x) => ({ symbol: x.symbol, side: x.side })),
      candidates: (plan.candidates ?? plan.items).map((x) => ({ symbol: x.symbol, side: x.side })),
      prevGainers: prevMarket?.gainers.map((g) => `${g.symbol}.NS`) ?? [],
      next,
      paperPct: planTrades.length ? (planTrades.reduce((a, t) => a + t.netPnl!, 0) / PAPER_SETTINGS.capital) * 100 : null,
    });
    await saveBaselineDay(b);
    baselineDays.push(e.date);
  }

  const stats = summariseSignals(await listSignalDays());
  const mults = Object.fromEntries(stats.filter((s) => s.effect !== "base").map((s) => [s.key, s.mult]));
  await setLearned("signals", mults);
  const closed = trades.filter((t) => t.status !== "open" && t.netPnl != null);
  const weights = adaptWeights(WEIGHTS.intraday, agentAccuracy(trades), closed.length);
  await setLearned("weights:intraday", weights);
  resetLearnedCache();
  return { signalDays, baselineDays, weights, muted: stats.filter((s) => s.verdict === "mute").map((s) => s.label) };
}

/* ---------------------------------------------- the scorecard ---------------------------------------------- */

export type Scorecard = Awaited<ReturnType<typeof getScorecard>>;

export async function getScorecard() {
  const [signalRows, baselines, trades, guard, learnedSignals, learnedWeights, improve] = await Promise.all([
    listSignalDays(),
    listBaselineDays(250),
    listTrades(5000),
    currentGuard().catch(() => null),
    getLearned<Record<string, number>>("signals").catch(() => null),
    getLearned<AdaptedWeights>("weights:intraday").catch(() => null),
    getLearned<ImproveState>("improve").catch(() => null),
  ]);
  const signals: SignalStat[] = summariseSignals(signalRows);
  const accuracy = agentAccuracy(trades);
  const calibration = calibrate(trades);
  const baselineSummary = summariseBaselines(baselines);
  const closed = trades.filter((t) => t.status !== "open" && t.netPnl != null);
  const weights = learnedWeights?.data ?? adaptWeights(WEIGHTS.intraday, accuracy, closed.length);
  const rec = trades.filter((t) => t.kind === "recommended");
  return {
    generatedAt: new Date().toISOString(),
    signalDays: new Set(signalRows.map((r) => r.day)).size,
    signals,
    accuracy,
    calibration,
    baselines: { summary: baselineSummary, days: baselines.slice(0, 30) },
    weights: { research: WEIGHTS.intraday, current: weights, updatedAt: learnedWeights?.updatedAt ?? null, adaptiveOff: process.env.ADAPTIVE_WEIGHTS === "off" },
    learnedAt: learnedSignals?.updatedAt ?? null,
    performance: { recommended: groupStats(rec), shadow: groupStats(trades.filter((t) => t.kind === "shadow")), riskDemoted: groupStats(trades.filter((t) => t.riskNote)) },
    guard,
    suggestions: suggestions({ signals, calibration, baselines: baselineSummary, accuracy }),
    improve: improve?.data ?? null,
    thresholds: { learn: THRESHOLDS.learn, guard: THRESHOLDS.guard, regime: THRESHOLDS.regime, improve: THRESHOLDS.improve },
  };
}
