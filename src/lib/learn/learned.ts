import "server-only";
import type { AgentId, Horizon } from "../agents/types";
import type { ExchangeSignal } from "../exchange/types";
import { signalKey, type AdaptedWeights } from "./core";
import { getLearned } from "./store";

/**
 * What the learning loop has learned, for the agents: signal multipliers (plan ranking) and
 * adapted score weights. Set ADAPTIVE_WEIGHTS=off to always use the research weights.
 */

let cache: { at: number; signals: Record<string, number>; weights: Partial<Record<Horizon, AdaptedWeights>> } | null = null;
const adaptiveOff = () => process.env.ADAPTIVE_WEIGHTS === "off";

export const resetLearnedCache = () => {
  cache = null;
};

async function load() {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache;
  const [signals, intraday] = await Promise.all([getLearned<Record<string, number>>("signals").catch(() => null), getLearned<AdaptedWeights>("weights:intraday").catch(() => null)]);
  cache = { at: Date.now(), signals: signals?.data ?? {}, weights: intraday ? { intraday: intraday.data } : {} };
  return cache;
}

/** Multiplier for an exchange signal when ranking candidates (1 until it has enough evidence; 0 = muted). */
export async function signalMultiplierFn(): Promise<(s: ExchangeSignal) => number> {
  if (adaptiveOff()) return () => 1;
  const { signals } = await load().catch(() => ({ signals: {} as Record<string, number> }));
  return (s) => signals[signalKey(s)] ?? 1;
}

/** Adapted score weights for a horizon, or null to use the research weights. */
export async function adaptedWeightsFor(horizon: Horizon): Promise<Record<AgentId, number> | null> {
  if (adaptiveOff()) return null;
  const w = (await load().catch(() => null))?.weights[horizon];
  return w?.adapted ? w.weights : null;
}
