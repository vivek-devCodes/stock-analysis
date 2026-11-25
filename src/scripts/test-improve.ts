import { applyTuning, buildImproveState, DEFAULT_TUNING, diagnoseTrade, gateTrade, netROf, setupLedger, simulateR, tuneExits, type Replayable } from "../lib/learn/improve";
import type { PaperTrade } from "../lib/paper/types";
import type { Candle } from "../lib/types";

// npm run test:improve — the self-improvement engine on synthetic days with known answers.

let failed = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  (${extra})` : ""}`);
};

const IST = 19800;
/** Unix seconds for an IST wall-clock time on day n (2026-09-01 + n days). */
const at = (n: number, hh: number, mm: number) => Date.UTC(2026, 8, 1 + n, hh, mm) / 1000 - IST;
const dayStr = (n: number) => new Date(Date.UTC(2026, 8, 1 + n)).toISOString().slice(0, 10);

/** 5-minute candles from 09:15 following a path of closes (each step one bar). */
function bars(n: number, path: number[], wick = 0.2): Candle[] {
  return path.map((close, i) => {
    const open = i ? path[i - 1] : path[0];
    return { time: at(n, 9, 15) + i * 300, open, high: Math.max(open, close) + wick, low: Math.min(open, close) - wick, close, volume: 1000 };
  });
}

function trade(n: number, over: Partial<PaperTrade>): PaperTrade {
  return {
    id: `T${n}-${over.symbol ?? "X"}`,
    tradeDay: dayStr(n),
    symbol: "TEST.NS",
    name: "Test",
    openedAt: new Date(at(n, 9, 45) * 1000).toISOString(),
    trigger: "plan",
    kind: "recommended",
    side: "long",
    decision: "BUY",
    validation: "APPROVED",
    score: 70,
    entry: 100,
    target: 102,
    stop: 99,
    qty: 10,
    riskReward: 2,
    reasons: [],
    votes: [],
    reportId: null,
    status: "stop",
    exitPrice: 99,
    exitAt: new Date(at(n, 10, 0) * 1000).toISOString(),
    grossPnl: null,
    costs: null,
    netPnl: null,
    returnPct: null,
    ...over,
  };
}

// Path: entry ~100 at 09:45 (bar 6), dips to 98.8 (below a 1R stop at 99, above 1.5R at 98.5), then rallies to 103.
const shakeout = [100, 100.2, 100.1, 100.3, 100.2, 100.1, 100, 99.6, 99.2, 98.9, 99.3, 100, 100.8, 101.5, 102.2, 102.8, 103, 103, 103];

/* ---------- applyTuning ---------- */
{
  const a = applyTuning("long", 100, 99, 102, { ...DEFAULT_TUNING, stopScale: 1.5, targetR: 2 });
  check("applyTuning widens the stop and sets an R target (long)", a.stop === 98.5 && a.target === 103, JSON.stringify(a));
  const b = applyTuning("short", 100, 101, 98, { ...DEFAULT_TUNING });
  check("applyTuning keeps a short's plan when untuned", b.stop === 101 && b.target === 98, JSON.stringify(b));
}

/* ---------- netR ---------- */
check("netR of a 1R stop is a bit worse than −1R (costs)", (netROf(trade(0, {}))! < -1) && netROf(trade(0, {}))! > -1.2, String(netROf(trade(0, {}))));

/* ---------- diagnosis ---------- */
{
  const c = bars(0, shakeout, 0.05);
  const d = diagnoseTrade(trade(0, { exitAt: new Date(at(0, 10, 0) * 1000).toISOString() }), c);
  check("stopped, then price reached the target → stop too tight", d?.cause === "stop-too-tight", d?.cause);

  const down = [100, 100, 100, 100, 100, 100, 100, 99.5, 98.8, 98.5, 98, 97.5, 97, 97, 97, 97, 97, 97, 97];
  const e = diagnoseTrade(trade(1, { exitAt: new Date(at(1, 10, 0) * 1000).toISOString() }), bars(1, down, 0.05));
  check("stopped within 30 min and never recovered → stopped early", e?.cause === "stopped-early", e?.cause);

  const niftyDown = bars(2, [200, 199.8, 199.5, 199.2, 199, 198.8, 198.5, 198.3, 198, 197.8], 0.05);
  const f = diagnoseTrade(trade(2, { exitAt: new Date(at(2, 11, 30) * 1000).toISOString() }), bars(2, down, 0.05), niftyDown);
  check("long while NIFTY fell since the open → against the market", f?.cause === "against-market" && f.aligned === false, `${f?.cause} aligned=${f?.aligned}`);

  const g = diagnoseTrade(trade(3, { status: "target", exitPrice: 102, exitAt: new Date(at(3, 10, 40) * 1000).toISOString() }), bars(3, shakeout, 0.05));
  check("target hit → clean win", g?.cause === "clean-win" && g.netR > 1.8, `${g?.cause} ${g?.netR.toFixed(2)}`);
}

/* ---------- counterfactual replay ---------- */
{
  const x: Replayable = { trade: trade(0, {}), candles: bars(0, shakeout, 0.05) };
  const asIs = simulateR(x, { stopScale: 1, targetR: null, breakEvenR: 0 });
  const wide = simulateR(x, { stopScale: 1.5, targetR: null, breakEvenR: 0 });
  check("replay: planned stop is hit on the shake-out", asIs != null && asIs < -0.9, String(asIs));
  check("replay: a 1.5× stop survives and reaches the target", wide != null && wide > 1.8, String(wide));
}

/* ---------- exit tuning: adopts a wider stop only when it also holds on the newest trades ---------- */
{
  const samples: Replayable[] = [];
  for (let i = 0; i < 36; i++) samples.push({ trade: trade(i, { id: `S${i}` }), candles: bars(i, shakeout, 0.05) });
  const res = tuneExits(samples, DEFAULT_TUNING);
  check("tuneExits needs enough trades", tuneExits(samples.slice(0, 10), DEFAULT_TUNING) === null);
  check("tuneExits adopts a wider stop for repeated shake-outs", Boolean(res?.adopted) && (res?.best.stopScale ?? 1) > 1, res?.reason);

  // Older trades favour a wide stop, the newest ones punish it → must NOT be adopted.
  const crash = [100, 100, 100, 100, 100, 100, 100, 99.6, 99.2, 98.9, 98.4, 97.8, 97.2, 96.8, 96.5, 96.3, 96.2, 96.1, 96];
  const mixed: Replayable[] = [];
  for (let i = 0; i < 24; i++) mixed.push({ trade: trade(i, { id: `M${i}` }), candles: bars(i, shakeout, 0.05) });
  for (let i = 24; i < 36; i++) mixed.push({ trade: trade(i, { id: `M${i}` }), candles: bars(i, crash, 0.05) });
  const res2 = tuneExits(mixed, DEFAULT_TUNING);
  check("tuneExits rejects a change that fails on the newest trades", res2 != null && !(res2.adopted && res2.best.stopScale > 1), res2?.reason);
}

/* ---------- setup ledger and gate ---------- */
{
  const losers = Array.from({ length: 20 }, (_, i) => trade(i, { id: `L${i}`, side: "short", decision: "SELL", score: 55, entry: 100, stop: 101, target: 98, exitPrice: i % 5 === 0 ? 98 : 101, status: i % 5 === 0 ? "target" : "stop" }));
  const winners = Array.from({ length: 20 }, (_, i) => trade(i, { id: `W${i}`, score: 80, exitPrice: i % 4 === 0 ? 99 : 102, status: i % 4 === 0 ? "stop" : "target" }));
  const fresh = Array.from({ length: 5 }, (_, i) => trade(i, { id: `F${i}`, trigger: "auto", score: 66 }));
  const ledger = setupLedger([...losers, ...winners, ...fresh]);
  const get = (k: string) => ledger.find((s) => s.key === k);
  check("a losing setup is blocked", get("plan|short|50–64")?.status === "blocked", JSON.stringify(get("plan|short|50–64")));
  check("a winning setup is proven", get("plan|long|75+")?.status === "proven");
  check("a young setup is on probation at half size", get("live|long|65–74")?.status === "probation" && get("live|long|65–74")?.sizeMult === 0.5);

  const state = buildImproveState({ closed: [...losers, ...winners, ...fresh], diagnoses: [], replayable: [], previous: null });
  const g1 = gateTrade(state, { origin: "plan", side: "short", score: 55 });
  const g2 = gateTrade(state, { origin: "plan", side: "long", score: 80 });
  const g3 = gateTrade(state, { origin: "live", side: "short", score: 90 });
  check("gate: blocked setup → shadow", !g1.allow && Boolean(g1.note), g1.note ?? "");
  check("gate: proven setup → full size", g2.allow && g2.sizeMult === 1);
  check("gate: unseen setup → half size", g3.allow && g3.sizeMult === 0.5);
  check("gate: nothing learned yet → trade normally", gateTrade(null, { origin: "plan", side: "long", score: 10 }).allow);
}

/* ---------- rules learned from repeated mistakes ---------- */
{
  const down = [100, 100, 100, 100, 100, 100, 100, 99.5, 98.8, 98.5, 98, 97.5, 97, 97, 97, 97, 97, 97, 97];
  const closed = Array.from({ length: 16 }, (_, i) => trade(i, { id: `E${i}`, score: 40 + (i % 3) }));
  const diagnoses = closed.map((t, i) => diagnoseTrade(t, bars(i, down, 0.05))!).filter(Boolean);
  const state = buildImproveState({ closed, diagnoses, replayable: [], previous: null });
  check("many early stop-outs → wait for a 30-minute opening range", state.tuning.orbMinutes === 30, state.changes.join(" | "));
  check("losing low-score band → minimum score raised", (state.tuning.minScore ?? 0) >= 50, String(state.tuning.minScore));
  check("defensive mode when recent recommended trades lose with confidence", state.defensive);
  check("gate refuses unproven setups in defensive mode", !gateTrade(state, { origin: "live", side: "long", score: 90 }).allow);
  check("journal and causes are filled", state.journal.length === 16 && state.causes[0]?.cause === "stopped-early");

  // Evidence turns: the same engine relaxes its rules again.
  const good = Array.from({ length: 22 }, (_, i) => trade(i, { id: `G${i}`, score: 42, status: "target", exitPrice: 102 }));
  const later = buildImproveState({ closed: good, diagnoses: good.map((t, i) => diagnoseTrade(t, bars(i, shakeout, 0.05))!), replayable: [], previous: state.tuning });
  check("score floor is removed when low scores start winning", later.tuning.minScore === null, later.changes.join(" | "));
  check("opening range goes back to 15 minutes when early stops stop", later.tuning.orbMinutes === 15, String(later.tuning.orbMinutes));
}

console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
