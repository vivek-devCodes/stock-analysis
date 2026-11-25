import "server-only";
import { runAnalysis } from "../agents/graph";
import { mapLimit } from "../agents/scan";
import { THRESHOLDS } from "../agents/thresholds";
import type { AnalysisReport } from "../agents/types";
import { SHORT_PAGE } from "../exchange/catalog";
import { interpretMarket, interpretStock, netDirection } from "../exchange/interpret";
import { getMarketDay, getStockDays, missingFiles } from "../exchange/store";
import type { ExchangeSignal } from "../exchange/types";
import { signalMultiplierFn } from "../learn/learned";
import { getLiveQuotes } from "../live";
import { notify } from "../notify";
import { fetchChart } from "../yahoo";
import { currentGuard, getRegime } from "./guard";
import { admit, atrPctOf, positionSize } from "./risk";
import { runScreen } from "../screener";
import { istDate, istTimeOn, marketPhase, orbEntry, PAPER_SETTINGS, SESSION } from "./rules";
import { activePlanFor, finishPlan, getPlan, planExecutedOn, savePlan } from "./plan-store";
import { insertTrade } from "./store";
import type { PaperKind, PaperTrade, PlanExecution, PlanItem, SessionPlan } from "./types";
import { applyTuning, DEFAULT_TUNING, gateTrade } from "../learn/improve";
import { currentImprovement, marketAgrees } from "../learn/improve-run";
import { learnedNote } from "./learned-note";
import { latestScreen } from "../insider/run";
import { compassAgainst } from "../compass/core";
import { currentCompass, recordCompass } from "../compass/fetch";

/**
 * The agent's day:
 *   after the close  → buildNextSessionPlan(): screen every intraday setup from the session that
 *                      just ended, re-rank with NSE exchange data (delivery, F&O build-up, PCR, OI
 *                      walls, deals) after removing restricted stocks (GSM, T2T, tight bands,
 *                      circuits), run the full multi-agent analysis on the best few and save
 *                      tomorrow's intraday plan.
 *   at the open      → executePendingPlan(): the first task of the session — each planned trade
 *                      waits for the 15-minute opening range, then enters on a breakout in its
 *                      direction (until 11:00), subject to the risk rules (regime, daily loss,
 *                      position/sector limits, drawdown pause).
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

  const [regime, mult] = await Promise.all([getRegime().catch(() => null), signalMultiplierFn()]);
  const plan: SessionPlan = {
    madeOn,
    createdAt: new Date().toISOString(),
    exchangeDate: market?.tradeDate ?? null,
    missingFiles: missing,
    status: "pending",
    marketNote: [interpretMarket(market).map((s) => `${s.label}: ${s.value}`).join(" · ") || "NSE market data unavailable.", regime ? `Regime: ${regime.level} — ${regime.notes.join("; ")}` : null].filter(Boolean).join(" · "),
    regime,
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
  const directional = screen.picks.filter((p) => p.bias !== "neutral");
  plan.candidates = directional.map((p) => ({ symbol: p.symbol, side: p.bias === "bullish" ? ("long" as const) : ("short" as const), score: p.score }));
  const picks = directional.sort((a, b) => Math.abs(b.score) - Math.abs(a.score)).slice(0, P.candidates);

  // 2. Exchange data: drop restricted stocks, re-rank by agreement with delivery / F&O / deals.
  const days = market ? await getStockDays(picks.map((p) => base(p.symbol)), market.tradeDate) : new Map();
  const ranked = picks
    .map((p) => {
      const sig = interpretStock(days.get(base(p.symbol)) ?? null, null, madeOn);
      const block = sig.find((x) => x.blocks?.includes("intraday"));
      const { score: ex } = netDirection(sig, DIRECTION_IDS, DIRECTION_WEIGHTS, mult);
      const dir = p.bias === "bullish" ? 1 : -1;
      return { p, sig, block, rank: Math.abs(p.score) + 15 * ex * dir };
    })
    .filter((x) => {
      if (x.block) plan.skipped.push({ symbol: x.p.symbol, reason: `${x.block.label} (${x.block.value}) — ${SHORT_PAGE[x.block.source]}` });
      return !x.block;
    })
    .sort((a, b) => b.rank - a.rank);
  for (const x of ranked.slice(P.analysed)) plan.skipped.push({ symbol: x.p.symbol, reason: "Lower ranked after exchange data" });

  // 3. Full multi-agent analysis on the best few — plus up to 2 insider-buying stocks whose daily
  //    chart is "Setup ready" (NSE insider-trading strategy), if the screen didn't already find them.
  const insider = await latestScreen().catch(() => null);
  const insiderReady = (insider?.buying ?? []).filter((p) => p.chart.verdict === "ready").slice(0, 6);
  const insiderBonus = new Map(insiderReady.map((p) => [`${p.symbol}.NS`, p]));
  for (const x of ranked) {
    const ip = insiderBonus.get(x.p.symbol);
    if (ip && x.p.bias === "bullish") x.rank += ip.insiderScore / 4;
    if (insider?.selling.some((s) => `${s.symbol}.NS` === x.p.symbol) && x.p.bias === "bullish") x.rank -= 10;
  }
  ranked.sort((a, b) => b.rank - a.rank);
  const chosen = ranked.slice(0, P.analysed);
  for (const ip of insiderReady) {
    if (chosen.length >= P.analysed + 2) break;
    const sym = `${ip.symbol}.NS`;
    if (chosen.some((c) => c.p.symbol === sym)) continue;
    chosen.push({ p: { symbol: sym, bias: "bullish", score: ip.rank } as (typeof chosen)[number]["p"], sig: [], block: undefined, rank: ip.rank });
  }
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

const fmtMinute = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;

/**
 * First task of the session: work through last night's plan. Each item waits for the opening range
 * (09:15–09:30) and enters on a breakout in its direction; items still waiting at 11:00 are dropped.
 * Runs on every paper-trading run until every item is final. Entries are de-duplicated per symbol
 * per day by the store, so overlapping runs cannot double-enter.
 */
export async function executePendingPlan(): Promise<PlanExecution | null> {
  const now = nowS();
  if (marketPhase(now) !== "open") return null;
  const today = istDate(now);
  const plan = await activePlanFor(today, istDate(now - P.expireDays * 86400));
  if (!plan) return null;

  const prev = new Map((plan.execution?.rows ?? []).map((r) => [r.symbol, r]));
  const todo = plan.items.filter((i) => !(prev.get(i.symbol)?.final ?? false));
  const sessionOpen = istTimeOn(now, SESSION.open);
  const pastDeadline = now >= istTimeOn(now, P.orbDeadline);
  const [guard, quotes, market, learned] = await Promise.all([
    currentGuard(),
    todo.length ? getLiveQuotes(todo.map((i) => i.symbol)).catch(() => []) : Promise.resolve([]),
    getMarketDay().catch(() => null),
    currentImprovement(),
  ]);
  const tuning = learned?.tuning ?? DEFAULT_TUNING;
  // Market Compass (global cues, GIFT Nifty, pre-open breadth, VIX): recorded once the pre-open
  // session has data, and used to halve the size of trades it argues against.
  const compass = await currentCompass().then((c) => c.compass).catch(() => null);
  if (compass) await recordCompass(compass).catch(() => undefined);
  const exch = market && todo.length ? await getStockDays(todo.map((i) => base(i.symbol)), market.tradeDate).catch(() => new Map()) : new Map();

  for (const item of todo) {
    const q = quotes.find((x) => x.symbol === item.symbol);
    const candles = await fetchChart(item.symbol, "1d", "5m")
      .then((c) => c.candles)
      .catch(() => []);
    const d = orbEntry({
      side: item.side,
      ref: item.refPrice,
      stop: item.stop,
      target: item.target,
      maxChase: P.maxChasePct,
      candles,
      sessionOpen,
      orbMinutes: tuning.orbMinutes,
      quote: q && q.time >= sessionOpen ? { price: q.price, time: q.time } : null,
    });
    if (d.action !== "enter") {
      const final = d.action === "skip" || pastDeadline;
      const reason = d.action === "wait" && pastDeadline ? `No opening-range breakout by ${fmtMinute(P.orbDeadline)} — dropped` : d.reason;
      prev.set(item.symbol, { symbol: item.symbol, entered: false, reason, price: q?.price ?? null, tradeId: null, final, range: d.range });
      continue;
    }
    let kind = item.kind;
    let riskNote: string | null = null;
    // Self-improvement: learned exits, setup gate (blocked setups become shadow) and market direction.
    const exits = applyTuning(item.side, d.price, item.stop, item.target, tuning);
    const gate = gateTrade(learned, { origin: "plan", side: item.side, score: item.score });
    if (kind === "recommended") {
      riskNote = admit(guard, { symbol: item.symbol, side: item.side });
      if (!riskNote && !gate.allow) riskNote = gate.note;
      if (!riskNote && tuning.marketAlign && (await marketAgrees(item.side, d.at)) === false) riskNote = "Against NIFTY's direction since the open (learned market-direction filter)";
      if (riskNote) kind = "shadow";
    }
    const against = compassAgainst(compass, item.side);
    const learnMult = kind === "recommended" ? gate.sizeMult * (against >= 0.5 ? 0.5 : 1) : 1;
    const learnNote = [learnedNote(tuning, learnMult, gate), against >= 0.5 ? `Market Compass against (${compass?.biasText}) — half size` : null].filter(Boolean).join("; ") || null;
    const qty = positionSize(d.price, exits.stop, PAPER_SETTINGS.capital, PAPER_SETTINGS.riskPct, { mult: (guard.sizeMult > 0 ? guard.sizeMult : 1) * learnMult, atrPct: atrPctOf(exch.get(base(item.symbol))) });
    if (qty < 1) {
      prev.set(item.symbol, { symbol: item.symbol, entered: false, reason: "Position size below one share", price: d.price, tradeId: null, final: true, range: d.range });
      continue;
    }
    const at = new Date(d.at * 1000);
    const edge = item.side === "long" ? d.range.high : d.range.low;
    const trade: PaperTrade = {
      id: `PT-${today.replace(/-/g, "")}-${item.symbol.replace(/[^A-Z0-9]/gi, "")}`,
      tradeDay: today,
      symbol: item.symbol,
      name: item.name,
      openedAt: at.toISOString(),
      trigger: "plan",
      planMadeOn: plan.madeOn,
      kind,
      side: item.side,
      decision: item.decision,
      validation: item.validation,
      score: item.score,
      entry: d.price,
      target: exits.target,
      stop: exits.stop,
      qty,
      riskReward: Math.abs(exits.target - d.price) / Math.abs(d.price - exits.stop),
      reasons: [
        ...item.reasons,
        `Planned after the ${plan.madeOn} close; entered on the opening-range ${item.side === "long" ? "breakout above" : "breakdown below"} ${edge.toFixed(2)} at ${at.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" })} IST.`,
        ...(riskNote ? [`Risk rule — ${riskNote}`] : []),
        ...(learnNote ? [`Learned — ${learnNote}`] : []),
      ],
      votes: item.votes,
      reportId: item.reportId,
      riskNote,
      breakEvenR: tuning.breakEvenR,
      learnNote,
      status: "open",
      exitPrice: null,
      exitAt: null,
      grossPnl: null,
      costs: null,
      netPnl: null,
      returnPct: null,
    };
    const inserted = await insertTrade(trade);
    prev.set(item.symbol, {
      symbol: item.symbol,
      entered: inserted,
      reason: inserted ? `Entered ${item.side} at ${d.price.toFixed(2)}${riskNote ? ` as shadow (${riskNote})` : ""}` : "Already traded today",
      price: d.price,
      tradeId: inserted ? trade.id : null,
      final: true,
      range: d.range,
    });
    if (inserted && kind === "recommended") void notify.entry(trade).catch(() => undefined);
  }

  const rows = plan.items.map((i) => prev.get(i.symbol)).filter((r): r is NonNullable<typeof r> => Boolean(r));
  const risk = guard.reasons.length ? guard.reasons : guard.regime ? [`Regime ${guard.regime.level}: ${guard.regime.notes.join("; ")}`] : [];
  const execution: PlanExecution = { day: today, at: new Date().toISOString(), rows, risk };
  const allFinal = rows.length === plan.items.length && rows.every((r) => r.final !== false);
  await finishPlan({ ...plan, status: allFinal ? "executed" : "executing", execution });
  return execution;
}

/**
 * After the session: a plan still "executing" (no run reached the breakout deadline) is closed out —
 * items still waiting are recorded as dropped. Called by the daily report.
 */
export async function closeOutPlan(day: string): Promise<void> {
  const plan = await planExecutedOn(day);
  if (!plan || plan.status !== "executing" || !plan.execution) return;
  const rows = plan.execution.rows.map((r) => (r.final === false ? { ...r, final: true, reason: `No opening-range breakout by ${fmtMinute(P.orbDeadline)} — dropped` } : r));
  for (const i of plan.items) if (!rows.some((r) => r.symbol === i.symbol)) rows.push({ symbol: i.symbol, entered: false, reason: "Not checked during the session", price: null, tradeId: null, final: true });
  await finishPlan({ ...plan, status: "executed", execution: { ...plan.execution, rows } });
}
