// The learning loop: measure every signal, every agent and every score band against what the
// market actually did, compare the agent with simple baselines, and turn the evidence into
// bounded weight adjustments. Pure; safe on client and server; covered by src/scripts/test-learn.ts.

import { THRESHOLDS } from "../agents/thresholds";
import type { AgentId } from "../agents/types";
import { interpretStock } from "../exchange/interpret";
import type { ExchangeSignal, StockDay } from "../exchange/types";
import type { AgentAccuracy } from "../paper/stats";
import type { PaperSide, PaperTrade } from "../paper/types";

const L = THRESHOLDS.learn;
const COST_PCT = THRESHOLDS.costs.intradayRoundTripPct;

/* ------------------------------------------- signal scorecard ------------------------------------------- */

/** Learning key of a directional signal: build-up keeps its four flavours apart, others split by direction. */
export const signalKey = (s: Pick<ExchangeSignal, "id" | "label" | "effect">) => (s.id === "buildup" ? `buildup:${s.label.toLowerCase()}` : `${s.id}:${s.effect}`);

/** One signal's results on one day: how often its direction matched the NEXT session's move. */
export type SignalObs = {
  key: string;
  id: string;
  label: string;
  effect: "bullish" | "bearish" | "base";
  n: number;
  /** Next session open → close moved the signal's way. This is what an intraday trade captures. */
  correct: number;
  /** Sum of directional open → close returns, % (before costs). */
  sumRet: number;
  /** Previous close → next close moved the signal's way (includes the overnight gap). */
  correctCc: number;
  sumRetCc: number;
};

export type NextDay = { open: number; close: number };

/**
 * Scores the signals NSE data gave after session `day` against the next session. Only liquid EQ
 * stocks that could be traded intraday are used. A "base rate" row (every liquid stock, long) is
 * added so a signal can be compared with simply buying everything.
 */
export function scoreSignals(day: string, stocks: Iterable<StockDay>, next: Map<string, NextDay>): SignalObs[] {
  const acc = new Map<string, SignalObs>();
  const add = (key: string, id: string, label: string, effect: SignalObs["effect"], dir: 1 | -1, s: StockDay, nx: NextDay) => {
    const oc = (dir * (nx.close - nx.open) / nx.open) * 100;
    const cc = (dir * (nx.close - s.close) / s.close) * 100;
    const row = acc.get(key) ?? { key, id, label, effect, n: 0, correct: 0, sumRet: 0, correctCc: 0, sumRetCc: 0 };
    row.n += 1;
    if (oc > 0) row.correct += 1;
    if (cc > 0) row.correctCc += 1;
    row.sumRet += oc;
    row.sumRetCc += cc;
    acc.set(key, row);
  };
  for (const s of stocks) {
    if (s.series !== "EQ" || s.turnoverLacs < L.liquidCr * 100 || s.gsm || s.bandHit || !(s.close > 0)) continue;
    const nx = next.get(s.symbol);
    if (!nx || !(nx.open > 0) || !(nx.close > 0)) continue;
    add("_base:long", "_base", "Every liquid stock, long", "base", 1, s, nx);
    for (const sig of interpretStock(s, null, day)) {
      if (sig.effect !== "bullish" && sig.effect !== "bearish") continue;
      add(signalKey(sig), sig.id, sig.id === "buildup" ? sig.label : `${sig.label}${sig.effect === "bearish" && sig.id === "volume" ? " (down day)" : sig.id === "volume" ? " (up day)" : ""}`, sig.effect, sig.effect === "bullish" ? 1 : -1, s, nx);
    }
  }
  return [...acc.values()];
}

export type SignalStat = SignalObs & {
  days: number;
  hitRate: number | null;
  avgRet: number | null;
  /** Average return after the intraday round-trip cost. */
  avgNet: number | null;
  hitRateCc: number | null;
  /**
   * Hit rate minus what the market gave anyway: for a bullish signal, minus the share of liquid
   * stocks that closed above their open; for a bearish one, minus the share that closed below.
   * Judging by the edge stops a falling market from making every short signal look good.
   */
  edge: number | null;
  verdict: "keep" | "mute" | "learning";
  /** Multiplier applied to the signal's weight when ranking plan candidates. */
  mult: number;
};

export function summariseSignals(rows: Array<SignalObs & { day: string }>): SignalStat[] {
  const baseRows = rows.filter((r) => r.effect === "base");
  const baseN = baseRows.reduce((a, r) => a + r.n, 0);
  const baseHit = baseN ? baseRows.reduce((a, r) => a + r.correct, 0) / baseN : null;
  const by = new Map<string, SignalObs & { days: Set<string> }>();
  for (const r of rows) {
    const cur = by.get(r.key) ?? { ...r, n: 0, correct: 0, sumRet: 0, correctCc: 0, sumRetCc: 0, days: new Set<string>() };
    cur.n += r.n;
    cur.correct += r.correct;
    cur.sumRet += r.sumRet;
    cur.correctCc += r.correctCc;
    cur.sumRetCc += r.sumRetCc;
    cur.days.add(r.day);
    by.set(r.key, cur);
  }
  return [...by.values()]
    .map(({ days, ...r }) => {
      const hit = r.n ? r.correct / r.n : null;
      const enough = r.n >= L.minSignalObs && r.effect !== "base";
      const edge = hit == null || baseHit == null || r.effect === "base" ? null : hit - (r.effect === "bullish" ? baseHit : 1 - baseHit);
      // Weighted by the edge (0.5 + edge acts as a market-neutral hit rate); raw hit rate without a base.
      const mult = r.effect === "base" ? 1 : signalMultiplier(r.n, edge != null ? 0.5 + edge : hit);
      return {
        ...r,
        days: days.size,
        hitRate: hit,
        avgRet: r.n ? r.sumRet / r.n : null,
        avgNet: r.n ? r.sumRet / r.n - COST_PCT : null,
        hitRateCc: r.n ? r.correctCc / r.n : null,
        edge,
        verdict: (!enough ? "learning" : mult === 0 ? "mute" : "keep") as SignalStat["verdict"],
        mult,
      };
    })
    .sort((a, b) => (a.effect === "base" ? -1 : b.effect === "base" ? 1 : (b.edge ?? b.hitRate ?? 0) - (a.edge ?? a.hitRate ?? 0)));
}

/** 1 until the signal has enough observations; 0 (muted) at or below a coin flip (no edge); otherwise 0.5–1.5×. */
export function signalMultiplier(n: number, hitRate: number | null): number {
  if (n < L.minSignalObs || hitRate == null) return 1;
  if (hitRate < L.muteBelow) return 0;
  return clamp(1 + (hitRate - 0.5) * 4, L.weightFloor, L.weightCeil);
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/* ------------------------------------------- score calibration ------------------------------------------- */

export type CalibrationBucket = { label: string; min: number; max: number; trades: number; wins: number; winRate: number | null; avgReturnPct: number | null; netPnl: number };

export const SCORE_BUCKETS: Array<[string, number, number]> = [
  ["< 50", -Infinity, 50],
  ["50–64", 50, 65],
  ["65–74", 65, 75],
  ["75+", 75, Infinity],
];

/** Win rate by agent score: if higher scores don't win more often, the scoring is miscalibrated. */
export function calibrate(trades: PaperTrade[]): { buckets: CalibrationBucket[]; monotonic: boolean | null; note: string } {
  const closed = trades.filter((t) => t.status !== "open" && t.netPnl != null && t.score != null);
  const buckets = SCORE_BUCKETS.map(([label, min, max]) => {
    const g = closed.filter((t) => t.score! >= min && t.score! < max);
    const wins = g.filter((t) => t.netPnl! > 0).length;
    return {
      label,
      min,
      max,
      trades: g.length,
      wins,
      winRate: g.length ? wins / g.length : null,
      avgReturnPct: g.length ? g.reduce((a, t) => a + (t.returnPct ?? 0), 0) / g.length : null,
      netPnl: g.reduce((a, t) => a + t.netPnl!, 0),
    };
  });
  const usable = buckets.filter((b) => b.trades >= 10);
  let monotonic: boolean | null = null;
  if (usable.length >= 2) monotonic = usable.every((b, i) => i === 0 || (b.winRate ?? 0) >= (usable[i - 1].winRate ?? 0) - 0.02);
  const note =
    monotonic == null
      ? `Needs at least 10 closed trades in two score bands (have ${closed.length} closed trades with a score).`
      : monotonic
        ? "Higher scores win more often — the score is meaningful."
        : "Higher scores do NOT win more often — the scoring is miscalibrated; treat the score with caution.";
  return { buckets, monotonic, note };
}

/* ------------------------------------------------ baselines ------------------------------------------------ */

export type BaselinePick = { symbol: string; side: PaperSide; open: number; close: number; retPct: number };
export type BaselineLeg = { picks: BaselinePick[]; avgNetPct: number | null };
export type BaselineDay = {
  day: string;
  /** Agent's plan, entered at the open and held to the close — same rules as the baselines. */
  agent: BaselineLeg;
  /** Previous session's top gainers, bought at the open. */
  topGainers: BaselineLeg;
  /** Random picks (seeded by the date) from the same screened candidates, in the screen's direction. */
  random: BaselineLeg;
  /** What the agent's paper trades actually made (stops, targets, ORB entries), % of capital. */
  paperPct: number | null;
};

function leg(list: Array<{ symbol: string; side: PaperSide }>, next: Map<string, NextDay>): BaselineLeg {
  const picks: BaselinePick[] = [];
  for (const p of list) {
    const nx = next.get(p.symbol.replace(/\.(NS|BO)$/, ""));
    if (!nx || !(nx.open > 0)) continue;
    const dir = p.side === "long" ? 1 : -1;
    picks.push({ symbol: p.symbol, side: p.side, open: nx.open, close: nx.close, retPct: ((dir * (nx.close - nx.open)) / nx.open) * 100 });
  }
  return { picks, avgNetPct: picks.length ? picks.reduce((a, p) => a + p.retPct, 0) / picks.length - COST_PCT : null };
}

/** Deterministic pseudo-random sample, seeded by a string (the same day always gives the same picks). */
export function seededSample<T>(items: T[], k: number, seed: string): T[] {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const rand = () => {
    h = (Math.imul(h ^ (h >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
    return h / 2 ** 32;
  };
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, k);
}

export function baselineDay(input: {
  day: string;
  planItems: Array<{ symbol: string; side: PaperSide }>;
  candidates: Array<{ symbol: string; side: PaperSide }>;
  prevGainers: string[];
  next: Map<string, NextDay>;
  paperPct: number | null;
}): BaselineDay {
  const k = L.baselinePicks;
  return {
    day: input.day,
    agent: leg(input.planItems, input.next),
    topGainers: leg(input.prevGainers.slice(0, k).map((symbol) => ({ symbol, side: "long" as const })), input.next),
    random: leg(seededSample(input.candidates, k, input.day), input.next),
    paperPct: input.paperPct,
  };
}

export type BaselineSummary = { key: "agent" | "topGainers" | "random"; label: string; days: number; avgNetPct: number | null; cumPct: number; winDays: number };

export function summariseBaselines(days: BaselineDay[]): BaselineSummary[] {
  const labels = { agent: "Agent's plan (open → close)", topGainers: "Yesterday's top gainers", random: "Random picks from the same screen" } as const;
  return (Object.keys(labels) as Array<keyof typeof labels>).map((key) => {
    const vals = days.map((d) => d[key].avgNetPct).filter((v): v is number => v != null);
    return {
      key,
      label: labels[key],
      days: vals.length,
      avgNetPct: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
      cumPct: (vals.reduce((a, v) => a * (1 + v / 100), 1) - 1) * 100,
      winDays: vals.filter((v) => v > 0).length,
    };
  });
}

/* ------------------------------------------- adaptive agent weights ------------------------------------------- */

export type AdaptedWeights = {
  weights: Record<AgentId, number>;
  adapted: boolean;
  notes: string[];
  closedTrades: number;
};

/**
 * Research weights scaled by each agent's real hit rate on closed paper trades (0.5×–1.5×), then
 * rescaled to the same total. Agents without enough calls keep their research weight; nothing
 * changes until the horizon has enough closed trades.
 */
export function adaptWeights(base: Record<AgentId, number>, accuracy: AgentAccuracy[], closedTrades: number): AdaptedWeights {
  if (closedTrades < L.minTradesToAdapt) {
    return { weights: { ...base }, adapted: false, closedTrades, notes: [`Research weights in use — adapts after ${L.minTradesToAdapt} closed trades (have ${closedTrades}).`] };
  }
  const total = Object.values(base).reduce((a, b) => a + b, 0);
  const raw = {} as Record<AgentId, number>;
  const notes: string[] = [];
  for (const [agent, w] of Object.entries(base) as Array<[AgentId, number]>) {
    const a = accuracy.find((x) => x.agent === agent);
    if (!a || a.calls < L.minAgentCalls || a.accuracy == null || w === 0) {
      raw[agent] = w;
      continue;
    }
    const m = clamp(1 + (a.accuracy - 0.5) * 4, L.weightFloor, L.weightCeil);
    raw[agent] = w * m;
    if (Math.abs(m - 1) >= 0.1) notes.push(`${a.label}: ${(a.accuracy * 100).toFixed(0)}% right on ${a.calls} calls → weight ×${m.toFixed(2)}`);
  }
  const sum = Object.values(raw).reduce((a, b) => a + b, 0);
  const weights = {} as Record<AgentId, number>;
  for (const [agent, w] of Object.entries(raw) as Array<[AgentId, number]>) weights[agent] = sum ? Math.round(((w * total) / sum) * 10) / 10 : w;
  return { weights, adapted: true, closedTrades, notes: notes.length ? notes : ["Every agent is within 10% of its research weight."] };
}

/* ---------------------------------------------- suggestions ---------------------------------------------- */

/** Plain-English review of what the evidence says — for the weekly email and the Scorecard page. */
export function suggestions(input: { signals: SignalStat[]; calibration: ReturnType<typeof calibrate>; baselines: BaselineSummary[]; accuracy: AgentAccuracy[] }): string[] {
  const out: string[] = [];
  const base = input.signals.find((s) => s.effect === "base");
  const vs = (s: SignalStat) => (s.edge != null ? `${s.edge >= 0 ? "+" : ""}${(s.edge * 100).toFixed(0)} points vs the market` : "");
  for (const s of input.signals.filter((x) => x.verdict === "mute")) {
    if (s.edge != null && s.edge <= -0.08) out.push(`"${s.label}" (${s.effect}) works in REVERSE: right only ${(s.hitRate! * 100).toFixed(0)}% of ${s.n} times (${vs(s)}). Muted; if this holds over a few months, consider flipping its meaning.`);
    else out.push(`Muted "${s.label}" (${s.effect}): right ${(s.hitRate! * 100).toFixed(0)}% of ${s.n} times (${vs(s)}) — no edge.`);
  }
  for (const s of input.signals.filter((x) => x.verdict === "keep" && (x.edge ?? 0) >= 0.05 && (x.avgNet ?? 0) > 0)) out.push(`Trust "${s.label}" (${s.effect}) more: right ${(s.hitRate! * 100).toFixed(0)}% of ${s.n} times (${vs(s)}), ${s.avgNet! >= 0 ? "+" : ""}${s.avgNet!.toFixed(2)}% average after costs.`);
  const days = Math.max(0, ...input.signals.map((s) => s.days));
  if (days > 0 && days < 60) out.push(`Only ${days} session${days === 1 ? "" : "s"} scored so far — one market phase. Treat these verdicts as provisional until about 60 sessions (3 months).`);
  if (input.calibration.monotonic === false) out.push("Scores are miscalibrated: high-score trades are not winning more often. Review the score weights or raise the approve threshold.");
  const agent = input.baselines.find((b) => b.key === "agent");
  const best = input.baselines.filter((b) => b.key !== "agent" && b.avgNetPct != null).sort((a, b) => b.avgNetPct! - a.avgNetPct!)[0];
  if (agent?.avgNetPct != null && best?.avgNetPct != null && agent.days >= 10) {
    out.push(agent.avgNetPct > best.avgNetPct ? `The agent beats the best baseline (${best.label}) by ${(agent.avgNetPct - best.avgNetPct).toFixed(2)}% a day over ${agent.days} days.` : `The agent is NOT beating "${best.label}" (${agent.avgNetPct.toFixed(2)}% vs ${best.avgNetPct.toFixed(2)}% a day over ${agent.days} days) — it isn't adding value yet.`);
  }
  for (const a of input.accuracy.filter((x) => x.calls >= L.minAgentCalls && x.accuracy != null && x.accuracy < 0.45)) out.push(`${a.label} is right only ${(a.accuracy! * 100).toFixed(0)}% of ${a.calls} calls — its weight is being reduced.`);
  if (base?.hitRate != null && base.n >= 500) out.push(`Base rate: ${(base.hitRate * 100).toFixed(0)}% of liquid stocks closed above their open (so ${(100 - base.hitRate * 100).toFixed(0)}% below). Signals are judged by how much they beat this.`);
  if (!out.length) out.push("Not enough evidence yet for changes — keep collecting (signals need 100 observations, agents 30 calls).");
  return out;
}
