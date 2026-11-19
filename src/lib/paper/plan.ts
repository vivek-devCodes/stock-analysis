import "server-only";
import { runAnalysis } from "../agents/graph";
import { mapLimit } from "../agents/scan";
import { THRESHOLDS } from "../agents/thresholds";
import type { AnalysisReport } from "../agents/types";
import { SHORT_PAGE } from "../exchange/catalog";
import { interpretMarket, interpretStock, netDirection } from "../exchange/interpret";
import { getMarketDay, getStockDays, missingFiles } from "../exchange/store";
import type { ExchangeSignal } from "../exchange/types";
import { getLiveQuotes } from "../live";
import { runScreen } from "../screener";
import { istDate, istTimeOn, marketPhase, PAPER_SETTINGS, planEntry, SESSION, sizeFor } from "./rules";
import { claimPendingPlan, finishPlan, getPlan, savePlan } from "./plan-store";
import { insertTrade } from "./store";
import type { PaperKind, PaperTrade, PlanExecution, PlanItem, SessionPlan } from "./types";

/**
 * The agent's day:
 *   after the close  → buildNextSessionPlan(): screen every intraday setup from the session that
 *                      just ended, re-rank with NSE exchange data (delivery, F&O build-up, PCR, OI
 *                      walls, deals) after removing restricted stocks (GSM, T2T, tight bands,
 *                      circuits), run the full multi-agent analysis on the best few and save
 *                      tomorrow's intraday plan.
 *   at the open      → executePendingPlan(): the first task of the session — enter each planned
 *                      trade at the live price unless the open gapped through the stop or target,
 *                      or price has already run too far.
 *   after the close  → the daily report scores every decision (report.ts).
 */

const P = THRESHOLDS.plan;
const DIRECTION_IDS = ["delivery", "volume", "deals", "52w", "buildup", "pcr", "oi-res", "oi-sup"];
const DIRECTION_WEIGHTS = { buildup: 2, delivery: 2, deals: 1.5, pcr: 1, volume: 1, "52w": 1, "oi-res": 1, "oi-sup": 1 };
const nowS = () => Math.floor(Date.now() / 1000);
const base = (s: string) => s.replace(/\.(NS|BO)$/, "");

const evidenceOf = (sig: ExchangeSignal[]) =>
  sig
    .filter((x) => x.effect !== "info" || x.id === "oi-range")
    .map((x) => ({ label: x.label, value: x.value, effect: x.effect, source: SHORT_PAGE[x.source] }));

function toPlanItem(r: AnalysisReport, sig: ExchangeSignal[]): { item: PlanItem } | { reason: string } {
  const plan = r.risk.plan;
  if (r.validation === "INSUFFICIENT DATA") return { reason: "Insufficient data" };
  if (!plan) return { reason: `${r.decision} — no directional plan (${r.validator.checks.find((c) => c.status === "fail")?.detail ?? "rejected"})` };
  const kind: PaperKind = r.decision === "BUY" || r.decision === "SELL" || r.decision === "WATCHLIST" ? "recommended" : "shadow";
  const ref = r.price.value ?? (plan.direction === "long" ? plan.entryHigh : plan.entryLow);
  const target = plan.targets[0];
  const sane = plan.direction === "long" ? plan.stop < ref && ref < target : target < ref && ref < plan.stop;
  if (!sane) return { reason: "Stop / target inconsistent with the last price" };
  const pick = (id: string) => r.agents.find((a) => a.agent === id);
  return {
    item: {
      symbol: r.instrument.symbol,
      name: r.instrument.name,
      kind,
      side: plan.direction,
      decision: r.decision,
      validation: r.validation,
      score: r.score.total,
      refPrice: ref,
      entryLow: plan.entryLow,
      entryHigh: plan.entryHigh,
      trigger: plan.trigger,
      stop: plan.stop,
      target,
      riskReward: plan.riskReward,
      reasons: [r.headline, pick("technical")?.summary, pick("fno")?.status === "ok" ? `F&O: ${pick("fno")!.summary}` : null, pick("ownership")?.status === "ok" ? `Flows: ${pick("ownership")!.summary}` : null, ...(kind === "shadow" ? r.validator.checks.filter((c) => c.status === "fail").slice(0, 2).map((c) => `Rejected — ${c.name}: ${c.detail}`) : [])].filter(Boolean) as string[],
      exchange: evidenceOf(sig),
      votes: r.agents.map((a) => ({ agent: a.agent, bias: a.bias, score: a.score })),
      reportId: r.id,
    },
  };
}

/** Build tomorrow's intraday plan. Runs after the close (refuses during market hours). */
export async function buildNextSessionPlan(force = false): Promise<SessionPlan> {
  const now = nowS();
  const madeOn = istDate(now);
  const phase = marketPhase(now);
  if (phase === "warm-up" || phase === "open" || phase === "no-new-entries") {
    throw new Error("The next-session plan is built after the close (15:30 IST); during the session the live paper-trading run is used.");
  }
  const market = await getMarketDay().catch(() => null);
  const existing = await getPlan(madeOn);
  if (existing && existing.status !== "pending") return existing;
  const missing: string[] = market ? missingFiles(market) : [];
  if (existing && !force && existing.exchangeDate === (market?.tradeDate ?? null) && !(existing.missingFiles ?? []).some((f) => !missing.includes(f))) return existing;

  const plan: SessionPlan = {
    madeOn,
    createdAt: new Date().toISOString(),
    exchangeDate: market?.tradeDate ?? null,
    missingFiles: missing,
    status: "pending",
    marketNote: interpretMarket(market).map((s) => `${s.label}: ${s.value}`).join(" · ") || "NSE market data unavailable.",
    screened: 0,
    items: [],
    skipped: [],
    errors: [],
    execution: null,
  };
  if (!market) plan.errors.push("NSE exchange files could not be loaded; the plan uses price data only.");
  else if (market.tradeDate !== madeOn) plan.errors.push(`Latest NSE files are for ${market.tradeDate} (today's are not published yet).`);
  if (missing.length) plan.errors.push(`Not yet published by NSE: ${missing.join(", ")} — the plan is rebuilt when they arrive.`);

  // 1. Every directional intraday setup from the session that just ended.
  const screen = await runScreen("intraday");
  plan.screened = screen.picks.length;
  const picks = screen.picks.filter((p) => p.bias !== "neutral").sort((a, b) => Math.abs(b.score) - Math.abs(a.score)).slice(0, P.candidates);

  // 2. Exchange data: drop restricted stocks, re-rank by agreement with delivery / F&O / deals.
  const days = market ? await getStockDays(picks.map((p) => base(p.symbol)), market.tradeDate) : new Map();
  const ranked = picks
    .map((p) => {
      const sig = interpretStock(days.get(base(p.symbol)) ?? null, null, madeOn);
      const block = sig.find((x) => x.blocks?.includes("intraday"));
      const { score: ex } = netDirection(sig, DIRECTION_IDS, DIRECTION_WEIGHTS);
      const dir = p.bias === "bullish" ? 1 : -1;
      return { p, sig, block, rank: Math.abs(p.score) + 15 * ex * dir };
    })
    .filter((x) => {
      if (x.block) plan.skipped.push({ symbol: x.p.symbol, reason: `${x.block.label} (${x.block.value}) — ${SHORT_PAGE[x.block.source]}` });
      return !x.block;
    })
    .sort((a, b) => b.rank - a.rank);
  for (const x of ranked.slice(P.analysed)) plan.skipped.push({ symbol: x.p.symbol, reason: "Lower ranked after exchange data" });

  // 3. Full multi-agent analysis on the best few.
  const chosen = ranked.slice(0, P.analysed);
  const reports = await mapLimit(chosen, 2, (x) =>
    runAnalysis({ symbol: x.p.symbol, horizon: "intraday" }).catch((e) => {
      plan.errors.push(`${x.p.symbol}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }),
  );
  reports.forEach((r, i) => {
    if (!r) return;
    const res = toPlanItem(r, chosen[i].sig);
    if ("reason" in res) plan.skipped.push({ symbol: r.instrument.symbol, reason: res.reason });
    else plan.items.push(res.item);
  });
  plan.items.sort((a, b) => (a.kind === b.kind ? (b.score ?? 0) - (a.score ?? 0) : a.kind === "recommended" ? -1 : 1));
  await savePlan(plan);
  return plan;
}

/**
 * First task of the session: enter last night's plan at the live price. Runs at most once per
 * plan (claimed atomically). Only inside the entry window.
 */
export async function executePendingPlan(): Promise<PlanExecution | null> {
  const now = nowS();
  if (marketPhase(now) !== "open") return null;
  const today = istDate(now);
  const plan = await claimPendingPlan(today, istDate(now - P.expireDays * 86400));
  if (!plan) return null;

  const rows: PlanExecution["rows"] = [];
  const quotes = plan.items.length ? await getLiveQuotes(plan.items.map((i) => i.symbol)).catch(() => []) : [];
  const sessionOpen = istTimeOn(now, SESSION.open);
  for (const item of plan.items) {
    const q = quotes.find((x) => x.symbol === item.symbol);
    if (!q || q.time < sessionOpen) {
      rows.push({ symbol: item.symbol, entered: false, reason: "No live price from today's session", price: q?.price ?? null, tradeId: null });
      continue;
    }
    const check = planEntry(item.side, item.refPrice, item.stop, item.target, q.price, P.maxChasePct);
    if (!check.ok) {
      rows.push({ symbol: item.symbol, entered: false, reason: check.reason, price: q.price, tradeId: null });
      continue;
    }
    const qty = sizeFor(q.price, item.stop, PAPER_SETTINGS.capital, PAPER_SETTINGS.riskPct);
    if (qty < 1) {
      rows.push({ symbol: item.symbol, entered: false, reason: "Position size below one share", price: q.price, tradeId: null });
      continue;
    }
    const at = new Date(q.time * 1000);
    const trade: PaperTrade = {
      id: `PT-${today.replace(/-/g, "")}-${item.symbol.replace(/[^A-Z0-9]/gi, "")}`,
      tradeDay: today,
      symbol: item.symbol,
      name: item.name,
      openedAt: at.toISOString(),
      trigger: "plan",
      planMadeOn: plan.madeOn,
      kind: item.kind,
      side: item.side,
      decision: item.decision,
      validation: item.validation,
      score: item.score,
      entry: q.price,
      target: item.target,
      stop: item.stop,
      qty,
      riskReward: Math.abs(item.target - q.price) / Math.abs(q.price - item.stop),
      reasons: [...item.reasons, `Planned after the ${plan.madeOn} close; entered at the open check (${at.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" })} IST, ${q.source}).`],
      votes: item.votes,
      reportId: item.reportId,
      status: "open",
      exitPrice: null,
      exitAt: null,
      grossPnl: null,
      costs: null,
      netPnl: null,
      returnPct: null,
    };
    const inserted = await insertTrade(trade);
    rows.push({ symbol: item.symbol, entered: inserted, reason: inserted ? `Entered ${item.side} at ${q.price.toFixed(2)}` : "Already traded today", price: q.price, tradeId: inserted ? trade.id : null });
  }
  const execution: PlanExecution = { day: today, at: new Date().toISOString(), rows };
  await finishPlan({ ...plan, status: "executed", execution });
  return execution;
}
