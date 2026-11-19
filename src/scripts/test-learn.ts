/**
 * Learning loop, risk rules, opening-range entries and the momentum + quality portfolio — checked on
 * hand-built data with known answers, plus the SQL against an embedded Postgres (PGlite).
 * Run: npm run test:learn
 */
import { PGlite } from "@electric-sql/pglite";
import { setDbForTesting } from "../lib/db/client";
import { SCHEMA } from "../lib/db/schema";
import type { StockDay } from "../lib/exchange/types";
import { adaptWeights, baselineDay, calibrate, scoreSignals, seededSample, signalMultiplier, summariseBaselines, summariseSignals } from "../lib/learn/core";
import { listSignalDays, saveSignalDay, scoredSignalDays, setLearned, getLearned } from "../lib/learn/store";
import { momentumOf, PORTFOLIO, rebalance, selectBasket, valueOf, type Candidate } from "../lib/portfolio/core";
import { activePlanFor, claimPendingPlan, finishPlan, savePlan } from "../lib/paper/plan-store";
import { assessRegime } from "../lib/paper/regime";
import { admit, atrPctOf, drawdownPct, evaluateGuard, positionSize, sectorOf } from "../lib/paper/risk";
import { orbEntry, replayTrade } from "../lib/paper/rules";
import { claimOnce, getFlag, setFlag } from "../lib/paper/store";
import type { PaperTrade, SessionPlan } from "../lib/paper/types";
import type { Candle } from "../lib/types";

let fail = 0;
const ok = (cond: boolean, name: string, info = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${info ? `  (${info})` : ""}`);
};
const near = (a: number | null | undefined, b: number, eps = 1e-6) => a != null && Math.abs(a - b) < eps;

/* --------------------------------------------- regime --------------------------------------------- */
const rising = Array.from({ length: 30 }, (_, i) => 100 + i);
const falling = Array.from({ length: 30 }, (_, i) => 130 - i);
const flat = Array.from({ length: 30 }, (_, i) => 100 + (i % 2 ? 0.1 : -0.1));
let r = assessRegime({ asOf: "2026-11-19", vix: 14, vixChangePct: 1, niftyCloses: rising });
ok(r.level === "calm" && r.trend === "up" && r.allowLong && !r.allowShort && r.sizeMult === 1, "Calm uptrend: full size, longs only", JSON.stringify({ level: r.level, trend: r.trend }));
r = assessRegime({ asOf: null, vix: 14, vixChangePct: 0, niftyCloses: falling });
ok(r.trend === "down" && !r.allowLong && r.allowShort, "Downtrend: shorts only");
r = assessRegime({ asOf: null, vix: 19, vixChangePct: 0, niftyCloses: rising });
ok(r.level === "caution" && r.sizeMult === 0.5 && r.maxNewTrades === 3, "VIX 19 → caution, half size, 3 positions");
r = assessRegime({ asOf: null, vix: 15, vixChangePct: 12, niftyCloses: rising });
ok(r.level === "caution", "VIX jump ≥ 10% → caution");
r = assessRegime({ asOf: null, vix: 26, vixChangePct: 0, niftyCloses: rising });
ok(r.level === "stand-aside" && r.sizeMult === 0 && !r.allowLong && !r.allowShort, "VIX 26 → stand aside");
r = assessRegime({ asOf: null, vix: 14, vixChangePct: 0, niftyCloses: flat });
ok(r.trend === "choppy" && r.level === "caution" && r.allowLong && r.allowShort, "Choppy NIFTY → caution, both sides");
r = assessRegime({ asOf: null, vix: null, vixChangePct: null, niftyCloses: [] });
ok(r.level === "calm" && r.trend === "unknown" && r.allowLong && r.allowShort, "No data → no restriction from the regime");

/* ------------------------------------------- risk rules ------------------------------------------- */
const calm = assessRegime({ asOf: null, vix: 14, vixChangePct: 0, niftyCloses: flat.map((x, i) => x + i * 0) });
ok(near(drawdownPct(100_000, [1000, -5000, 2000]), (3000 / 101000) * 100), "Drawdown measured from the equity peak");
let g = evaluateGuard({ capital: 100_000, todayClosedNet: 0, open: [], closedNets: [], regime: null });
ok(g.allowNew && g.slots === 5 && !g.paused, "Fresh account: 5 slots, trading allowed");
g = evaluateGuard({ capital: 100_000, todayClosedNet: -2100, open: [], closedNets: [], regime: null });
ok(!g.allowNew && g.dailyLossHit, "Daily loss ≥ 2% stops new trades");
g = evaluateGuard({ capital: 100_000, todayClosedNet: 0, open: [], closedNets: [-9000], regime: null });
ok(!g.allowNew && g.paused, "Drawdown ≥ 8% pauses recommended trades");
g = evaluateGuard({ capital: 100_000, todayClosedNet: 0, open: [{ symbol: "A.NS" }, { symbol: "B.NS" }, { symbol: "C.NS" }], closedNets: [], regime: calm });
ok(calm.level === "caution" && !g.allowNew && g.slots === 0, "Caution regime caps positions at 3", `slots ${g.slots}`);
g = evaluateGuard({ capital: 100_000, todayClosedNet: 0, open: [{ symbol: "HDFCBANK.NS" }, { symbol: "SBIN.NS" }], closedNets: [], regime: null });
ok(sectorOf("ICICIBANK.NS") === "Banking", "Sector map knows ICICIBANK");
ok(admit(g, { symbol: "ICICIBANK.NS", side: "long" })?.startsWith("Sector limit") === true, "Third bank is blocked by the sector cap");
ok(admit(g, { symbol: "TCS.NS", side: "long" }) === null && g.slots === 2, "Another sector is admitted and books a slot");
const upG = evaluateGuard({ capital: 100_000, todayClosedNet: 0, open: [], closedNets: [], regime: assessRegime({ asOf: null, vix: 14, vixChangePct: 0, niftyCloses: rising }) });
ok(admit(upG, { symbol: "TCS.NS", side: "short" })?.includes("uptrend") === true, "Short against an uptrend is shadow-only");
ok(positionSize(100, 99, 100_000, 1) === 250, "Size capped at 25% of capital (₹1,000 risk would buy 1,000)", String(positionSize(100, 99, 100_000, 1)));
ok(positionSize(100, 95, 100_000, 1) === 200, "₹1,000 risk / ₹5 stop = 200 shares");
ok(positionSize(100, 95, 100_000, 1, { mult: 0.5 }) === 100, "Caution regime halves the size");
ok(positionSize(100, 95, 100_000, 1, { atrPct: 6 }) === 100, "ATR 6% vs 3% cap → half the shares");
ok(atrPctOf({ annualVol: 0.3176, close: 100, high: 101, low: 99 } as StockDay)! > 2 && atrPctOf({ annualVol: null, close: 100, high: 104, low: 100 } as StockDay) === 4, "ATR proxy from NSE volatility, else the day's range");

/* ---------------------------------------- break-even replay ---------------------------------------- */
const DAY = Date.UTC(2026, 10, 18) / 1000;
const ist = (h: number, m: number) => DAY + (h * 60 + m) * 60 - 5.5 * 3600;
const bar = (h: number, m: number, o: number, hi: number, lo: number, c: number): Candle => ({ time: ist(h, m), open: o, high: hi, low: lo, close: c, volume: 1000 });
const T = { side: "long" as const, entry: 100, target: 103, stop: 99, openedAt: ist(10, 0) };
let rr = replayTrade(T, [bar(10, 0, 100, 101.2, 100, 101.1), bar(10, 5, 101, 101, 99.9, 99.95)], ist(16, 0));
ok(rr?.status === "breakeven" && rr.exitPrice === 100, "+1R close moves the stop to entry; pullback exits at entry", JSON.stringify(rr));
rr = replayTrade(T, [bar(10, 0, 100, 101.2, 100, 100.5), bar(10, 5, 100.5, 100.6, 99.5, 99.6)], ist(16, 0));
ok(rr == null || rr.status !== "breakeven", "Touching +1R intrabar (close below) does not move the stop", JSON.stringify(rr));
rr = replayTrade(T, [bar(10, 0, 100, 101.2, 100, 101.1), bar(10, 5, 101, 101, 99.9, 99.95)], ist(16, 0), 300, 0);
ok(rr == null || rr.status !== "breakeven", "breakEvenR = 0 disables the move");

/* ------------------------------------------ opening range ------------------------------------------ */
const open = ist(9, 15);
const orBars = [bar(9, 15, 100, 101, 99.5, 100.5), bar(9, 20, 100.5, 101.2, 100.2, 101), bar(9, 25, 101, 101.1, 100.4, 100.8)];
const base = { side: "long" as const, ref: 100, stop: 98, target: 105, maxChase: 0.5, sessionOpen: open, orbMinutes: 15, quote: null };
let d = orbEntry({ ...base, candles: orBars.slice(0, 2) });
ok(d.action === "wait", "Range still forming → wait");
d = orbEntry({ ...base, candles: orBars });
ok(d.action === "wait" && d.range?.high === 101.2 && d.range.low === 99.5, "Range complete, no breakout yet → wait", JSON.stringify(d.range));
d = orbEntry({ ...base, candles: [...orBars, bar(9, 30, 100.9, 101.6, 100.8, 101.5)] });
ok(d.action === "enter" && d.price === 101.2 && d.at === ist(9, 35), "Breakout fills at the range high, stamped at the candle's end", JSON.stringify(d));
d = orbEntry({ ...base, candles: [...orBars, bar(9, 30, 101.8, 102, 101.7, 101.9)] });
ok(d.action === "enter" && d.price === 101.8, "Gap above the range fills at the open");
d = orbEntry({ ...base, candles: [...orBars, bar(9, 30, 100.5, 100.6, 97.9, 98.2), bar(9, 35, 98.2, 102, 98, 101.9)] });
ok(d.action === "skip", "Stop touched before the breakout → setup void");
d = orbEntry({ ...base, candles: orBars, quote: { price: 101.4, time: ist(9, 33) } });
ok(d.action === "enter" && d.price === 101.4, "Live quote above the range enters when candles lag");
d = orbEntry({ ...base, candles: [...orBars, bar(9, 30, 103.5, 104, 103.4, 103.8)] });
ok(d.action === "skip" && d.reason.includes("not chasing"), "Breakout too far toward target → not chasing", d.action === "skip" ? d.reason : "");
d = orbEntry({ ...base, side: "short", stop: 102.5, target: 96, candles: [...orBars, bar(9, 30, 100.6, 100.7, 99.2, 99.3)] });
ok(d.action === "enter" && d.price === 99.5, "Short breakdown fills at the range low");

/* -------------------------------------------- signals -------------------------------------------- */
const mk = (symbol: string, p: Partial<StockDay>): StockDay =>
  ({
    symbol, series: "EQ", open: 100, high: 103, low: 99, close: 102, prevClose: 100, changePct: 2, volume: 1e6, turnoverLacs: 5000, trades: 1, deliveryQty: 1, deliveryPct: 70, deliveryAvg: 40,
    volumeAvg: 1e6, volRatio: 1, historyDays: 10, band: null, gsm: null, bandHit: null, fnoBan: false, inFno: false, lotSize: null, wk52High: null, wk52HighDate: null, wk52Low: null, wk52LowDate: null,
    annualVol: null, deals: [], fno: null, bse: null, ...p,
  }) as StockDay;
const day0 = [mk("AAA", {}), mk("BBB", {}), mk("CCC", { close: 98, changePct: -2 }), mk("ILLQ", { turnoverLacs: 10 })];
const next = new Map([
  ["AAA", { open: 102, close: 104 }],
  ["BBB", { open: 102, close: 101 }],
  ["CCC", { open: 98, close: 97 }],
  ["ILLQ", { open: 1, close: 2 }],
]);
const obs = scoreSignals("2026-11-18", day0, next);
const acc = obs.find((o) => o.key === "delivery:bullish");
const dist = obs.find((o) => o.key === "delivery:bearish");
const baseRow = obs.find((o) => o.key === "_base:long");
ok(acc?.n === 2 && acc.correct === 1, "Accumulation scored on the next open → close: 1 of 2 right", JSON.stringify(acc));
ok(dist?.n === 1 && dist.correct === 1 && near(dist.sumRet, (1 / 98) * 100, 1e-9), "Distribution (short) right when the next day falls");
ok(baseRow?.n === 3, "Illiquid stock excluded; base rate over 3 liquid stocks");
ok(signalMultiplier(50, 0.4) === 1 && signalMultiplier(100, 0.45) === 0 && near(signalMultiplier(200, 0.6), 1.4), "Multiplier: 1 while learning, 0 below a coin flip, 1.4 at 60%");
const stats = summariseSignals([...obs.map((o) => ({ ...o, day: "2026-11-18" })), ...obs.map((o) => ({ ...o, day: "2026-11-19" }))]);
const s1 = stats.find((s) => s.key === "delivery:bullish")!;
ok(s1.n === 4 && s1.days === 2 && s1.verdict === "learning" && stats[0].effect === "base", "Summary adds days; base rate first; < 100 obs = learning");
ok(near(s1.edge, 0.5 - 1 / 3) && near(stats.find((s) => s.key === "delivery:bearish")!.edge, 1 - 2 / 3), "Edge = hit rate minus the market's own up (or down) share");

/* ------------------------------------------ calibration ------------------------------------------ */
const trade = (score: number, net: number): PaperTrade => ({ score, netPnl: net, status: net > 0 ? "target" : "stop", returnPct: net / 100 }) as PaperTrade;
const cal = calibrate([...Array.from({ length: 10 }, (_, i) => trade(55, i < 4 ? 10 : -10)), ...Array.from({ length: 10 }, (_, i) => trade(80, i < 7 ? 10 : -10))]);
ok(cal.monotonic === true && near(cal.buckets[1].winRate, 0.4) && near(cal.buckets[3].winRate, 0.7), "Higher scores winning more → calibrated");
const bad = calibrate([...Array.from({ length: 10 }, (_, i) => trade(55, i < 7 ? 10 : -10)), ...Array.from({ length: 10 }, (_, i) => trade(80, i < 3 ? 10 : -10))]);
ok(bad.monotonic === false, "High scores losing more → miscalibrated");

/* ------------------------------------------- baselines ------------------------------------------- */
ok(JSON.stringify(seededSample([1, 2, 3, 4, 5, 6], 3, "2026-11-19")) === JSON.stringify(seededSample([1, 2, 3, 4, 5, 6], 3, "2026-11-19")), "Random baseline is reproducible for a date");
const bd = baselineDay({
  day: "2026-11-19",
  planItems: [{ symbol: "AAA.NS", side: "long" }, { symbol: "CCC.NS", side: "short" }],
  candidates: [{ symbol: "AAA.NS", side: "long" }],
  prevGainers: ["BBB"],
  next,
  paperPct: 0.5,
});
ok(near(bd.agent.avgNetPct, ((2 / 102) * 100 + (1 / 98) * 100) / 2 - 0.1, 1e-9), "Agent leg = average open → close after 0.1% cost");
ok(near(bd.topGainers.avgNetPct, (-1 / 102) * 100 - 0.1, 1e-9), "Top-gainers leg bought at the open");
const sum = summariseBaselines([bd, { ...bd, day: "2026-11-20" }]);
ok(sum[0].days === 2 && sum[0].winDays === 2, "Baseline summary counts days and winning days");

/* ----------------------------------------- adaptive weights ----------------------------------------- */
const W = { fundamental: 5, technical: 35, market: 20, news: 10, ownership: 10, quant: 10, fno: 10 };
let aw = adaptWeights(W, [], 10);
ok(!aw.adapted && aw.weights.technical === 35, "Too few trades → research weights");
aw = adaptWeights(W, [{ agent: "technical", label: "Technical", calls: 80, correct: 52, accuracy: 0.65, neutral: 0 }, { agent: "market", label: "Market", calls: 80, correct: 28, accuracy: 0.35, neutral: 0 }], 100);
const total = Object.values(aw.weights).reduce((a, b) => a + b, 0);
ok(aw.adapted && aw.weights.technical > 35 && aw.weights.market < 20 && Math.abs(total - 100) < 0.6, "Good agent up-weighted, poor one down, total kept", JSON.stringify(aw.weights));

/* ------------------------------------------- portfolio ------------------------------------------- */
const up = Array.from({ length: 250 }, (_, i) => 100 * 1.002 ** i);
const m = momentumOf(up);
ok(m.mom12! > 0 && m.mom6! > 0 && m.aboveSma200 === true, "Momentum of a rising series is positive, above its 200-day average");
ok(momentumOf(up.slice(0, 100)).mom12 === null, "Under 200 sessions → no 12-month momentum");
const cand = (symbol: string, sector: string, mom: number, quality: number, extra: Partial<Candidate> = {}): Candidate => ({ symbol, name: symbol, sector, price: 100, mom12: mom, mom6: mom / 2, aboveSma200: true, quality, roe: 20, debtToEquity: 0.3, financial: false, ...extra });
const pool = [
  ...Array.from({ length: 5 }, (_, i) => cand(`BANK${i}`, "Banking", 40 + i, 70, { financial: true, debtToEquity: 8 })),
  ...Array.from({ length: 12 }, (_, i) => cand(`IT${i}`, `S${i}`, 10 + i, 60 + i)),
  cand("WEAK", "X", -5, 90),
  cand("DEBT", "Y", 50, 90, { debtToEquity: 3 }),
  cand("DOWN", "Z", 50, 90, { aboveSma200: false }),
];
const sel = selectBasket(pool);
ok(sel.picks.length === PORTFOLIO.size, "Basket holds 12 stocks");
ok(sel.picks.filter((p) => p.sector === "Banking").length === 3, "At most 3 per sector (banks' D/E exempt)");
ok(!sel.picks.some((p) => ["WEAK", "DEBT", "DOWN"].includes(p.symbol)), "Negative momentum, high debt and downtrends are excluded");
const px = new Map(sel.picks.map((p) => [p.symbol, 100]));
const rb = rebalance({ day: "2026-12-01", prev: null, picks: sel.picks, prices: px });
ok(rb.holdings.every((h) => h.qty === Math.floor((PORTFOLIO.capital * (1 - 0.0015)) / 12 / 100)) && rb.cash > 0 && rb.costs > 0, "Equal weight with costs charged", `qty ${rb.holdings[0].qty}, costs ${rb.costs.toFixed(0)}`);
ok(near(valueOf(rb.holdings, rb.cash, px), rb.navAfter, 1e-6) && rb.navAfter < PORTFOLIO.capital, "Value after rebalance = capital − costs");
const rb2 = rebalance({ day: "2027-01-01", prev: { holdings: rb.holdings, cash: rb.cash }, picks: sel.picks.slice(0, 11), prices: px });
ok(rb2.exited.length === 1 && rb2.kept.length === 11 && rb2.entered.length === 0, "Next month: one exit, eleven kept");

/* --------------------------------------------- SQL --------------------------------------------- */
(async () => {
  const pg = new PGlite();
  const db = { query: async <T,>(t: string, p: unknown[] = []) => (await pg.query(t, p as unknown[])).rows as T[] };
  for (const s of SCHEMA) await db.query(s);
  setDbForTesting(db);

  await saveSignalDay("2026-11-18", obs);
  await saveSignalDay("2026-11-18", obs); // idempotent
  const rows = await listSignalDays();
  ok(rows.length === obs.length && (await scoredSignalDays()).has("2026-11-18"), "Signal day saved once (bulk upsert), marked as scored", `${rows.length} rows`);
  ok(rows.find((x) => x.key === "delivery:bearish")?.sumRet === dist!.sumRet, "Camel-case columns round-trip through jsonb_to_recordset");

  await setLearned("weights:intraday", aw);
  ok((await getLearned<typeof aw>("weights:intraday"))?.data.weights.technical === aw.weights.technical, "Learned weights stored and read back");

  ok(await claimOnce("weekly-2026-11-20"), "claimOnce: first claim");
  ok(!(await claimOnce("weekly-2026-11-20")), "claimOnce: second claim refused");
  await setFlag("drawdown-reset", { by: "test" });
  ok((await getFlag("drawdown-reset"))?.summary != null, "Drawdown reset flag stored");

  const plan = { madeOn: "2026-11-18", createdAt: "", exchangeDate: "2026-11-18", status: "pending", marketNote: "", screened: 1, items: [], skipped: [], errors: [], execution: null } as unknown as SessionPlan;
  await savePlan(plan);
  const claimed = await activePlanFor("2026-11-19", "2026-11-15");
  ok(claimed?.madeOn === "2026-11-18" && claimed.status === "executing", "Pending plan claimed at the open");
  ok((await activePlanFor("2026-11-19", "2026-11-15"))?.madeOn === "2026-11-18", "Claimed plan without an execution yet is picked up again (crash-safe)");
  await finishPlan({ ...claimed!, status: "executing", execution: { day: "2026-11-19", at: "", rows: [{ symbol: "AAA.NS", entered: false, reason: "waiting", price: null, tradeId: null, final: false }] } });
  ok((await activePlanFor("2026-11-19", "2026-11-15"))?.execution?.rows[0].final === false, "Executing plan returned on later runs the same day");
  ok((await activePlanFor("2026-11-20", "2026-11-16")) === null && (await claimPendingPlan("2026-11-20", "2026-11-16")) === null, "Not returned on another day");

  setDbForTesting(null);
  console.log(fail ? `\n${fail} check(s) FAILED` : "\nAll learning-loop, risk and portfolio checks passed");
  process.exit(fail ? 1 : 0);
})();
