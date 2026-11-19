/**
 * Paper-trading rule checks on hand-built candles with known answers.
 * Run: npm run test:paper
 */
import { istDate, istTimeOn, marketPhase, pnl, replayTrade, SESSION } from "../lib/paper/rules";
import { agentAccuracy, computeStats } from "../lib/paper/stats";
import type { Candle } from "../lib/types";
import type { PaperTrade } from "../lib/paper/types";

let fail = 0;
const ok = (cond: boolean, name: string, info = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${info ? `  (${info})` : ""}`);
};

// Wed 2026-11-18, IST. 10:00 IST = 04:30 UTC.
const DAY = Date.UTC(2026, 10, 18) / 1000;
const ist = (h: number, m: number) => DAY + (h * 60 + m) * 60 - 5.5 * 3600;
const bar = (h: number, m: number, o: number, hi: number, lo: number, c: number): Candle => ({ time: ist(h, m), open: o, high: hi, low: lo, close: c, volume: 1000 });
const T = (side: "long" | "short", entry: number, target: number, stop: number, h = 10, m = 0) => ({ side, entry, target, stop, openedAt: ist(h, m) });
const AFTER_CLOSE = ist(16, 30);

// Clock
ok(istDate(ist(10, 0)) === "2026-11-18", "IST date of 10:00 IST", istDate(ist(10, 0)));
ok(istTimeOn(ist(10, 0), SESSION.squareOff) === ist(15, 15), "15:15 IST cut-off on the same day");
ok(marketPhase(ist(9, 0)) === "pre-open", "09:00 → pre-open");
ok(marketPhase(ist(9, 20)) === "warm-up", "09:20 → warm-up (opening range forming)");
ok(marketPhase(ist(11, 0)) === "open", "11:00 → open");
ok(marketPhase(ist(14, 45)) === "no-new-entries", "14:45 → no new entries");
ok(marketPhase(ist(16, 0)) === "closed", "16:00 → closed");
ok(marketPhase(ist(11, 0) + 3 * 86400) === "weekend", "Saturday → weekend");

// Long: target reached first
const up = [bar(10, 5, 100, 100.5, 99.8, 100.4), bar(10, 10, 100.4, 102.1, 100.3, 102)];
let r = replayTrade(T("long", 100, 102, 99), up, AFTER_CLOSE);
ok(r?.status === "target" && r.exitPrice === 102, "Long hits target at the target price", JSON.stringify(r));

// Long: stop reached first
r = replayTrade(T("long", 100, 102, 99), [bar(10, 5, 100, 100.2, 98.9, 99.1)], AFTER_CLOSE);
ok(r?.status === "stop" && r.exitPrice === 99, "Long hits stop at the stop price");

// Same candle touches both → stop first (conservative)
r = replayTrade(T("long", 100, 102, 99), [bar(10, 5, 100, 102.5, 98.5, 101)], AFTER_CLOSE);
ok(r?.status === "stop", "Both touched in one candle → stop counts first");

// Gap through the stop exits at the (worse) open
r = replayTrade(T("long", 100, 102, 99), [bar(10, 5, 98, 98.5, 97.5, 98.2)], AFTER_CLOSE);
ok(r?.status === "stop" && r.exitPrice === 98, "Gap below stop exits at the open", String(r?.exitPrice));

// The candle that contains the entry time is ignored (no look-ahead)
r = replayTrade(T("long", 100, 102, 99, 10, 2), [bar(10, 0, 100, 103, 99.5, 101), bar(10, 5, 101, 101.2, 100.6, 101)], ist(10, 20));
ok(r == null, "Entry bar ignored; trade still open mid-session");

// Short: target below, stop above
r = replayTrade(T("short", 100, 98, 101), [bar(10, 5, 100, 100.3, 97.9, 98)], AFTER_CLOSE);
ok(r?.status === "target" && r.exitPrice === 98, "Short hits target");
r = replayTrade(T("short", 100, 98, 101), [bar(10, 5, 100, 101.4, 99.7, 101.2)], AFTER_CLOSE);
ok(r?.status === "stop" && r.exitPrice === 101, "Short hits stop");

// Neither → squared off at the close of the last candle before 15:15
const flat = [bar(10, 5, 100, 100.6, 99.6, 100.2), bar(15, 5, 100.2, 100.8, 100, 100.7), bar(15, 10, 100.7, 100.9, 100.4, 100.5), bar(15, 15, 100.5, 105, 95, 104)];
r = replayTrade(T("long", 100, 102, 99), flat, AFTER_CLOSE);
ok(r?.status === "square-off" && r.exitPrice === 100.5, "Square-off at the 15:10 candle close; post-cut-off candle ignored", JSON.stringify(r));

// Before the cut-off with no hit → still open
r = replayTrade(T("long", 100, 102, 99), flat.slice(0, 1), ist(12, 0));
ok(r == null, "Unresolved before 15:15 → still open");

// P&L after costs: long 100 → 102, 50 shares, 0.1% costs on ₹5,000 = ₹5
const p = pnl("long", 100, 102, 50, 0.001);
ok(Math.abs(p.gross - 100) < 1e-9 && Math.abs(p.costs - 5) < 1e-9 && Math.abs(p.net - 95) < 1e-9, "Long P&L: gross 100, costs 5, net 95", JSON.stringify(p));
const ps = pnl("short", 100, 98, 50, 0.001);
ok(Math.abs(ps.net - 95) < 1e-9, "Short P&L mirrors long", String(ps.net));

// Stats
const base: PaperTrade = {
  id: "x", tradeDay: "2026-11-18", symbol: "A.NS", name: "A", openedAt: new Date(ist(10, 0) * 1000).toISOString(), trigger: "auto", kind: "recommended",
  side: "long", decision: "WATCHLIST", validation: "APPROVED WITH CONDITIONS", score: 70, entry: 100, target: 102, stop: 99, qty: 50, riskReward: 2,
  reasons: [], votes: [{ agent: "technical", bias: "bullish", score: 70 }, { agent: "news", bias: "bearish", score: 40 }, { agent: "market", bias: "neutral", score: 50 }],
  reportId: null, status: "target", exitPrice: 102, exitAt: null, grossPnl: 100, costs: 5, netPnl: 95, returnPct: 1.9,
};
const trades: PaperTrade[] = [
  base,
  { ...base, id: "y", symbol: "B.NS", status: "stop", exitPrice: 99, netPnl: -55, returnPct: -1.1 },
  { ...base, id: "z", symbol: "C.NS", status: "open", exitPrice: null, netPnl: null, returnPct: null },
  { ...base, id: "s", symbol: "D.NS", kind: "shadow", decision: "NO TRADE", validation: "NO TRADE", status: "stop", exitPrice: 99, netPnl: -55, returnPct: -1.1 },
];
const st = computeStats(trades);
ok(st.overall.trades === 3 && st.overall.closed === 2 && st.overall.open === 1, "Headline counts exclude shadow trades");
ok(st.overall.winRate === 0.5 && st.overall.netPnl === 40, "Win rate 50%, net ₹40", `${st.overall.winRate} ${st.overall.netPnl}`);
ok(st.overall.profitFactor != null && Math.abs(st.overall.profitFactor - 95 / 55) < 1e-9, "Profit factor = 95 / 55");
ok(st.byVerdict.find((g) => g.key === "shadow")!.stats.closed === 1, "Shadow trades scored separately");
const acc = agentAccuracy(trades);
const tech = acc.find((a) => a.agent === "technical")!;
const news = acc.find((a) => a.agent === "news")!;
ok(tech.calls === 3 && tech.correct === 1, "Technical (bullish) right on the 1 up-move out of 3 closed", `${tech.correct}/${tech.calls}`);
ok(news.calls === 3 && news.correct === 2, "News (bearish) right on the 2 down-moves", `${news.correct}/${news.calls}`);
ok(acc.find((a) => a.agent === "market")!.calls === 0, "Neutral views are not counted");

console.log(fail ? `\n${fail} check(s) failed` : "\nAll paper-trading checks passed");
process.exit(fail ? 1 : 0);
