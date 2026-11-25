import { THRESHOLDS } from "../agents/thresholds";
import { COST_RATE, istTimeOn, replayTrade, SESSION } from "../paper/rules";
import type { PaperSide, PaperTrade } from "../paper/types";
import type { Candle } from "../types";

/**
 * Self-improvement engine (pure functions; the nightly job in improve-run.ts feeds them).
 *
 *  1. Post-mortem   — every closed paper trade gets a measured outcome in R (net of costs) and a
 *                     cause: stopped in the first 30 minutes, traded against the market, stop too
 *                     tight (price later reached the target), gave back a winner, no follow-through.
 *  2. Counterfactual tuning — the same trades are replayed on their own 5-minute candles with other
 *                     stop widths, targets and break-even rules. A change is adopted only when it is
 *                     better on the older two-thirds of trades AND not worse on the newest third
 *                     (out-of-sample), with enough trades on both sides.
 *  3. Setup ledger  — trades are grouped into setups (plan/live × long/short × score band). A setup
 *                     that has lost money with statistical confidence is blocked (it keeps running as
 *                     a paper "shadow" trade, so it can earn its way back); an unproven setup trades
 *                     at half size; a proven one at full size.
 *  4. Lessons       — the causes and every adjustment, in plain language, with the evidence.
 *
 * Nothing is fitted blindly: every rule needs a minimum sample, every parameter is bounded, and
 * ADAPTIVE_WEIGHTS=off switches the whole thing back to the fixed research rules.
 */

const L = THRESHOLDS.improve;

export type Tuning = {
  /** Multiplies the planned stop distance (1 = as planned). */
  stopScale: number;
  /** Target in R multiples from the entry; null keeps the planned target. */
  targetR: number | null;
  /** Move the stop to entry after a candle closes this many R in profit (0 = off). */
  breakEvenR: number;
  /** Minutes of the opening range a planned trade waits for. */
  orbMinutes: number;
  /** Only enter in the direction NIFTY is moving since the open. */
  marketAlign: boolean;
  /** Minimum agent score for a recommended trade (null = no extra floor). */
  minScore: number | null;
};

export const DEFAULT_TUNING: Tuning = {
  stopScale: 1,
  targetR: null,
  breakEvenR: THRESHOLDS.guard.breakEvenR,
  orbMinutes: THRESHOLDS.plan.orbMinutes,
  marketAlign: false,
  minScore: null,
};

/** Apply the stop / target tuning to a fresh entry. */
export function applyTuning(side: PaperSide, entry: number, stop: number, target: number, t: Tuning): { stop: number; target: number } {
  const dir = side === "long" ? 1 : -1;
  const risk = Math.abs(entry - stop) * t.stopScale;
  const newStop = entry - dir * risk;
  const newTarget = t.targetR != null ? entry + dir * t.targetR * risk : target;
  return { stop: round2(newStop), target: round2(newTarget) };
}

const round2 = (x: number) => Math.round(x * 100) / 100;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
function stderr(xs: number[]) {
  if (xs.length < 2) return Infinity;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1) / xs.length);
}

/* --------------------------------------------- 1. post-mortem --------------------------------------------- */

export type Cause = "clean-win" | "small-win" | "stopped-early" | "against-market" | "stop-too-tight" | "gave-back" | "no-follow-through" | "target-too-far" | "flat";

export const CAUSE_TEXT: Record<Cause, string> = {
  "clean-win": "Worked as planned",
  "small-win": "Small win (closed before the target)",
  "stopped-early": "Stopped out within 30 minutes of entry",
  "against-market": "Traded against the market's direction that day",
  "stop-too-tight": "Stop too tight: price later reached the target",
  "gave-back": "Was ≥ 1R in profit, then gave it back",
  "no-follow-through": "No follow-through after entry",
  "target-too-far": "Target too far: never reached, closed at square-off",
  flat: "Roughly flat",
};

export type Diagnosis = {
  id: string;
  day: string;
  symbol: string;
  side: PaperSide;
  origin: "plan" | "live";
  kind: PaperTrade["kind"];
  score: number | null;
  netR: number;
  mfeR: number;
  maeR: number;
  minutesHeld: number;
  /** NIFTY moved in the trade's direction between the open and the entry. null = unknown. */
  aligned: boolean | null;
  cause: Cause;
};

const originOf = (t: PaperTrade): "plan" | "live" => (t.trigger === "plan" ? "plan" : "live");
const sec = (iso: string | null) => (iso ? Math.floor(Date.parse(iso) / 1000) : 0);

/** R multiple of a closed trade, net of the round-trip cost. */
export function netROf(t: Pick<PaperTrade, "side" | "entry" | "stop" | "exitPrice">): number | null {
  const risk = Math.abs(t.entry - t.stop);
  if (!(risk > 0) || t.exitPrice == null) return null;
  const dir = t.side === "long" ? 1 : -1;
  return (dir * (t.exitPrice - t.entry) - t.entry * COST_RATE) / risk;
}

/**
 * Diagnose one closed trade from its day's 5-minute candles (and NIFTY's, for market alignment).
 * Returns null when the trade cannot be measured.
 */
export function diagnoseTrade(t: PaperTrade, candles: Candle[], nifty: Candle[] = [], barSeconds = 300): Diagnosis | null {
  const netR = netROf(t);
  if (netR == null || t.status === "open") return null;
  const risk = Math.abs(t.entry - t.stop);
  const dir = t.side === "long" ? 1 : -1;
  const opened = sec(t.openedAt);
  const exited = sec(t.exitAt) || opened;
  const cutoff = istTimeOn(opened, SESSION.squareOff);
  const held = candles.filter((c) => c.time >= opened && c.time < Math.max(exited, opened + barSeconds));
  const after = candles.filter((c) => c.time >= exited && c.time < cutoff);
  const mfeR = held.length ? Math.max(0, ...held.map((c) => (dir * ((dir > 0 ? c.high : c.low) - t.entry)) / risk)) : Math.max(0, netR);
  const maeR = held.length ? Math.min(0, ...held.map((c) => (dir * ((dir > 0 ? c.low : c.high) - t.entry)) / risk)) : Math.min(0, netR);
  const minutesHeld = Math.max(0, Math.round((exited - opened) / 60));

  // Market alignment: NIFTY's move from the session open to the entry time.
  let aligned: boolean | null = null;
  const sessionOpen = istTimeOn(opened, SESSION.open);
  const nDay = nifty.filter((c) => c.time >= sessionOpen && c.time <= opened).sort((a, b) => a.time - b.time);
  if (nDay.length >= 2) {
    const move = nDay.at(-1)!.close - nDay[0].open;
    aligned = Math.abs(move) / nDay[0].open < 0.0005 ? null : Math.sign(move) === dir;
  }

  const stopped = t.status === "stop";
  const reachedTargetLater = after.some((c) => (dir > 0 ? c.high >= t.target : c.low <= t.target));
  let cause: Cause;
  if (netR >= 0.1) cause = t.status === "target" ? "clean-win" : "small-win";
  else if (Math.abs(netR) < 0.1 && t.status !== "stop") cause = "flat";
  else if (stopped && reachedTargetLater) cause = "stop-too-tight";
  else if (aligned === false) cause = "against-market";
  else if (stopped && minutesHeld <= 30) cause = "stopped-early";
  else if (mfeR >= 1) cause = "gave-back";
  else if (t.status === "square-off" && mfeR >= 0.5) cause = "target-too-far";
  else cause = "no-follow-through";

  return { id: t.id, day: t.tradeDay, symbol: t.symbol, side: t.side, origin: originOf(t), kind: t.kind, score: t.score, netR, mfeR, maeR, minutesHeld, aligned, cause };
}

/* ------------------------------------------ 2. counterfactual tuning ------------------------------------------ */

export type Replayable = { trade: PaperTrade; candles: Candle[] };

/** Net R of a trade if it had been run with this tuning (same entry, same day's candles). */
export function simulateR(x: Replayable, t: Pick<Tuning, "stopScale" | "targetR" | "breakEvenR">, barSeconds = 300): number | null {
  const tr = x.trade;
  const opened = sec(tr.openedAt);
  const { stop, target } = applyTuning(tr.side, tr.entry, tr.stop, tr.target, { ...DEFAULT_TUNING, ...t });
  const res = replayTrade({ side: tr.side, entry: tr.entry, stop, target, openedAt: opened }, x.candles, opened + 86400, barSeconds, t.breakEvenR);
  if (!res) return null;
  const risk = Math.abs(tr.entry - stop);
  const dir = tr.side === "long" ? 1 : -1;
  // Express in the ORIGINAL trade's R so different stop widths are compared on the same money at risk.
  const r0 = Math.abs(tr.entry - tr.stop);
  return risk > 0 && r0 > 0 ? (dir * (res.exitPrice - tr.entry) - tr.entry * COST_RATE) / r0 : null;
}

export type TuningTrial = { stopScale: number; targetR: number | null; breakEvenR: number; train: number; test: number };

export type TuningResult = {
  current: TuningTrial;
  best: TuningTrial;
  adopted: boolean;
  reason: string;
  trades: { train: number; test: number };
};

/**
 * Grid search over stop width, target and break-even on the trades' own candles. Trades are split by
 * date: the older two-thirds choose, the newest third must confirm. Adopts only a real improvement.
 */
export function tuneExits(samples: Replayable[], current: Tuning): TuningResult | null {
  const usable = samples.filter((s) => s.candles.length > 0 && netROf(s.trade) != null).sort((a, b) => a.trade.openedAt.localeCompare(b.trade.openedAt));
  const cut = Math.floor((usable.length * 2) / 3);
  const train = usable.slice(0, cut);
  const test = usable.slice(cut);
  if (train.length < L.minTuneTrain || test.length < L.minTuneTest) return null;

  const score = (set: Replayable[], p: Pick<Tuning, "stopScale" | "targetR" | "breakEvenR">) => {
    const rs = set.map((s) => simulateR(s, p)).filter((r): r is number => r != null);
    return rs.length ? mean(rs) : -Infinity;
  };
  const trial = (p: Pick<Tuning, "stopScale" | "targetR" | "breakEvenR">): TuningTrial => ({ ...p, train: score(train, p), test: score(test, p) });

  const cur = trial(current);
  let best = cur;
  for (const stopScale of L.grid.stopScale)
    for (const targetR of L.grid.targetR)
      for (const breakEvenR of L.grid.breakEvenR) {
        const t = { stopScale, targetR, breakEvenR };
        const tr = trial(t);
        if (tr.train > best.train) best = tr;
      }

  const gain = best.train - cur.train;
  const holds = best.test >= cur.test;
  const adopted = best !== cur && gain >= L.minGainR && holds;
  const reason = best === cur
    ? "The current exits are already the best tested."
    : !holds
      ? `A different exit looked better on older trades (+${gain.toFixed(2)}R) but was worse on the newest trades, so it was NOT adopted (likely noise).`
      : gain < L.minGainR
        ? `Best alternative improves by only ${gain.toFixed(2)}R per trade — below the ${L.minGainR}R bar, so nothing changed.`
        : `Adopted: ${describeExit(best)} — ${gain >= 0 ? "+" : ""}${gain.toFixed(2)}R per trade on ${train.length} older trades and ${(best.test - cur.test).toFixed(2)}R on the ${test.length} newest.`;
  return { current: cur, best, adopted, reason, trades: { train: train.length, test: test.length } };
}

export const describeExit = (p: Pick<Tuning, "stopScale" | "targetR" | "breakEvenR">) =>
  `stop ${p.stopScale === 1 ? "as planned" : `${p.stopScale}× the planned distance`}, target ${p.targetR == null ? "as planned" : `${p.targetR}R`}, ${p.breakEvenR > 0 ? `break-even after ${p.breakEvenR}R` : "no break-even move"}`;

/* ------------------------------------------------ 3. setup ledger ------------------------------------------------ */

export type SetupStatus = "probation" | "unproven" | "proven" | "blocked";

export type SetupStat = {
  key: string;
  label: string;
  n: number;
  winRate: number;
  avgR: number;
  /** avgR ± one standard error. */
  low: number;
  high: number;
  status: SetupStatus;
  sizeMult: number;
};

const bandOf = (score: number | null) => {
  const s = Math.abs(score ?? 0);
  return s >= 75 ? "75+" : s >= 65 ? "65–74" : s >= 50 ? "50–64" : "<50";
};

export const setupKey = (x: { origin: "plan" | "live"; side: PaperSide; score: number | null }) => `${x.origin}|${x.side}|${bandOf(x.score)}`;
const setupLabel = (key: string) => {
  const [origin, side, band] = key.split("|");
  return `${origin === "plan" ? "Overnight plan" : "Live scan"} · ${side === "long" ? "long" : "short"} · score ${band}`;
};

export function setupLedger(trades: PaperTrade[]): SetupStat[] {
  const groups = new Map<string, number[]>();
  for (const t of trades) {
    if (t.status === "open") continue;
    const r = netROf(t);
    if (r == null) continue;
    const k = setupKey({ origin: originOf(t), side: t.side, score: t.score });
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.entries()]
    .map(([key, rs]) => {
      const m = mean(rs);
      const se = stderr(rs);
      const low = m - se;
      const high = m + se;
      const status: SetupStatus = rs.length < L.minSetupTrades ? "probation" : high < 0 ? "blocked" : low > 0 ? "proven" : "unproven";
      const sizeMult = status === "proven" ? 1 : status === "blocked" ? 0 : L.unprovenSize;
      return { key, label: setupLabel(key), n: rs.length, winRate: rs.filter((r) => r > 0).length / rs.length, avgR: m, low: Number.isFinite(low) ? low : m, high: Number.isFinite(high) ? high : m, status, sizeMult };
    })
    .sort((a, b) => b.n - a.n);
}

export type GateDecision = { allow: boolean; sizeMult: number; note: string | null; setup: SetupStat | null };

/** Should a new recommended trade go ahead, and at what size? Blocked setups become shadow trades. */
export function gateTrade(state: ImproveState | null, x: { origin: "plan" | "live"; side: PaperSide; score: number | null }): GateDecision {
  if (!state) return { allow: true, sizeMult: 1, note: null, setup: null };
  const tuning = state.tuning;
  if (tuning.minScore != null && Math.abs(x.score ?? 0) < tuning.minScore) {
    return { allow: false, sizeMult: 0, note: `Score ${Math.abs(x.score ?? 0)} is below the learned minimum of ${tuning.minScore}`, setup: null };
  }
  const setup = state.setups.find((s) => s.key === setupKey(x)) ?? null;
  if (setup?.status === "blocked") {
    return { allow: false, sizeMult: 0, note: `Setup "${setup.label}" has lost money: ${setup.n} trades, avg ${setup.avgR.toFixed(2)}R`, setup };
  }
  let mult = setup ? setup.sizeMult : L.unprovenSize;
  if (state.defensive) mult = Math.min(mult, L.unprovenSize);
  if (state.defensive && setup?.status !== "proven") {
    return { allow: false, sizeMult: 0, note: "Defensive mode: recent recommended trades lost money, so only proven setups are traded", setup };
  }
  return { allow: true, sizeMult: mult, note: null, setup };
}

/* --------------------------------------------- 4. lessons and rules --------------------------------------------- */

export type ImproveState = {
  updatedAt: string;
  trades: number;
  diagnosed: number;
  tuning: Tuning;
  changes: string[];
  lessons: string[];
  causes: Array<{ cause: Cause; label: string; count: number; share: number }>;
  setups: SetupStat[];
  exitTest: TuningResult | null;
  alignment: { aligned: { n: number; avgR: number }; against: { n: number; avgR: number } } | null;
  recent: { n: number; avgR: number; high: number } | null;
  defensive: boolean;
  journal: Array<Diagnosis & { causeText: string }>;
};

export function buildImproveState(input: {
  closed: PaperTrade[];
  diagnoses: Diagnosis[];
  replayable: Replayable[];
  previous: Tuning | null;
  now?: Date;
}): ImproveState {
  const prev = input.previous ?? DEFAULT_TUNING;
  const tuning: Tuning = { ...prev };
  const changes: string[] = [];
  const lessons: string[] = [];
  const d = input.diagnoses;
  const losses = d.filter((x) => x.netR < -0.1);

  // Causes of losing trades.
  const counts = new Map<Cause, number>();
  for (const x of losses) counts.set(x.cause, (counts.get(x.cause) ?? 0) + 1);
  const causes = [...counts.entries()]
    .map(([cause, count]) => ({ cause, label: CAUSE_TEXT[cause], count, share: losses.length ? count / losses.length : 0 }))
    .sort((a, b) => b.count - a.count);
  if (losses.length) lessons.push(`${losses.length} of ${d.length} measured trades lost money. Main cause: ${causes[0].label.toLowerCase()} (${causes[0].count}, ${(causes[0].share * 100).toFixed(0)}%).`);
  const share = (c: Cause) => (losses.length ? (counts.get(c) ?? 0) / losses.length : 0);

  // a) Exits: counterfactual replay with out-of-sample confirmation.
  const exitTest = tuneExits(input.replayable, tuning);
  if (exitTest?.adopted) {
    tuning.stopScale = exitTest.best.stopScale;
    tuning.targetR = exitTest.best.targetR;
    tuning.breakEvenR = exitTest.best.breakEvenR;
    changes.push(exitTest.reason);
  } else if (exitTest) lessons.push(`Exit test: ${exitTest.reason}`);
  else lessons.push(`Exit tuning waits for ${L.minTuneTrain + L.minTuneTest} trades with intraday candles (have ${input.replayable.length}).`);

  // b) Entry timing: too many early stop-outs → wait for a longer opening range (and back).
  if (losses.length >= L.minLossesForRule && share("stopped-early") >= L.earlyStopShare && tuning.orbMinutes < 30) {
    tuning.orbMinutes = 30;
    changes.push(`${(share("stopped-early") * 100).toFixed(0)}% of losses were stopped within 30 minutes, so planned trades now wait for a 30-minute opening range (was ${prev.orbMinutes}).`);
  } else if (
    tuning.orbMinutes > DEFAULT_TUNING.orbMinutes &&
    ((losses.length >= L.minLossesForRule && share("stopped-early") < L.earlyStopShare / 2) ||
      // Losses have mostly stopped: few early stop-outs across a good number of recent trades.
      (d.length >= 2 * L.minLossesForRule && (counts.get("stopped-early") ?? 0) / d.length < L.earlyStopShare / 4))
  ) {
    tuning.orbMinutes = DEFAULT_TUNING.orbMinutes;
    changes.push(`Early stop-outs fell to ${(share("stopped-early") * 100).toFixed(0)}% of losses, so the opening range is back to ${DEFAULT_TUNING.orbMinutes} minutes.`);
  }

  // c) Market alignment: compare trades with vs against NIFTY's direction at entry.
  const withM = d.filter((x) => x.aligned === true).map((x) => x.netR);
  const against = d.filter((x) => x.aligned === false).map((x) => x.netR);
  const alignment = withM.length || against.length ? { aligned: { n: withM.length, avgR: mean(withM) }, against: { n: against.length, avgR: mean(against) } } : null;
  if (withM.length >= L.minAlignTrades && against.length >= L.minAlignTrades) {
    const gap = mean(withM) - mean(against);
    if (!tuning.marketAlign && gap >= L.alignGapR && mean(against) < 0) {
      tuning.marketAlign = true;
      changes.push(`Trades against NIFTY's direction averaged ${mean(against).toFixed(2)}R vs ${mean(withM).toFixed(2)}R with it (${against.length} vs ${withM.length} trades), so new entries must now agree with the market's move since the open.`);
    } else if (tuning.marketAlign && gap < L.alignGapR / 2) {
      tuning.marketAlign = false;
      changes.push(`Trading with or against NIFTY no longer makes a clear difference (${gap.toFixed(2)}R), so the market-direction filter is off again.`);
    }
  }

  // d) Score floor: raise it while low-score trades lose money with confidence; lower it when they recover.
  const bands: Array<[number, number]> = [[0, 50], [50, 65], [65, 75]];
  let floor: number | null = null;
  for (const [lo, hi] of bands) {
    const rs = d.filter((x) => Math.abs(x.score ?? 0) >= lo && Math.abs(x.score ?? 0) < hi).map((x) => x.netR);
    if (rs.length >= L.minSetupTrades && mean(rs) + stderr(rs) < 0) floor = hi;
    else break;
  }
  if (floor !== tuning.minScore) {
    changes.push(floor != null ? `Trades scoring below ${floor} lost money with confidence, so recommended trades now need a score of ${floor}+ (lower scores still run as shadow trades to keep learning).` : `Low-score trades are no longer losing with confidence, so the extra score floor (${tuning.minScore}) is removed.`);
    tuning.minScore = floor;
  }

  // e) Setups, and the overall "is it making money?" check.
  const setups = setupLedger(input.closed);
  for (const s of setups.filter((x) => x.status === "blocked")) lessons.push(`Blocked setup: ${s.label} — ${s.n} trades, avg ${s.avgR.toFixed(2)}R, won ${(s.winRate * 100).toFixed(0)}%. It keeps running as a shadow trade and is unblocked if it starts making money.`);
  for (const s of setups.filter((x) => x.status === "proven")) lessons.push(`Proven setup: ${s.label} — ${s.n} trades, avg +${s.avgR.toFixed(2)}R. Traded at full size.`);
  const recentRs = input.closed
    .filter((t) => t.kind === "recommended" && t.status !== "open")
    .sort((a, b) => (b.exitAt ?? "").localeCompare(a.exitAt ?? ""))
    .slice(0, L.recentWindow)
    .map((t) => netROf(t))
    .filter((r): r is number => r != null);
  const recent = recentRs.length ? { n: recentRs.length, avgR: mean(recentRs), high: mean(recentRs) + stderr(recentRs) } : null;
  const defensive = Boolean(recent && recent.n >= L.minSetupTrades && recent.high < 0);
  if (defensive) lessons.push(`Defensive mode: the last ${recent!.n} recommended trades averaged ${recent!.avgR.toFixed(2)}R, so only proven setups are traded, at half size, until results recover.`);

  if (causes.some((c) => c.cause === "stop-too-tight" && c.share >= 0.3) && !changes.some((c) => c.startsWith("Adopted"))) lessons.push("Many stops were hit before the move played out. Wider stops are being tested on past trades and are adopted only if they also work on the newest ones.");
  if (share("gave-back") >= 0.25) lessons.push("Winners are being given back. Earlier break-even moves and closer targets are being tested.");
  if (share("no-follow-through") >= 0.4) lessons.push("Most losers never moved in our favour. The entry filters (score floor, market direction) are what can fix this.");
  if (!changes.length) lessons.push(d.length < L.minLossesForRule ? `Learning: ${d.length} trade(s) measured so far — the rules adapt once there is enough evidence.` : "No rule change today: the evidence does not justify one yet.");

  const journal = [...d].sort((a, b) => b.day.localeCompare(a.day)).slice(0, 25).map((x) => ({ ...x, causeText: CAUSE_TEXT[x.cause] }));
  return {
    updatedAt: (input.now ?? new Date()).toISOString(),
    trades: input.closed.length,
    diagnosed: d.length,
    tuning,
    changes,
    lessons,
    causes,
    setups,
    exitTest,
    alignment,
    recent,
    defensive,
    journal,
  };
}
