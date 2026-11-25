import { DEFAULT_TUNING, describeExit, type GateDecision, type Tuning } from "../learn/improve";

/** One line saying what the self-improvement engine changed for a new trade, or null for nothing. */
export function learnedNote(tuning: Tuning, sizeMult: number, gate: GateDecision): string | null {
  const parts: string[] = [];
  if (tuning.stopScale !== DEFAULT_TUNING.stopScale || tuning.targetR !== DEFAULT_TUNING.targetR || tuning.breakEvenR !== DEFAULT_TUNING.breakEvenR) parts.push(`exits: ${describeExit(tuning)}`);
  if (sizeMult < 1 && gate.allow) parts.push(`size ×${sizeMult} (${gate.setup ? `setup ${gate.setup.status}: ${gate.setup.n} trades, avg ${gate.setup.avgR.toFixed(2)}R` : "setup not yet proven"})`);
  return parts.length ? parts.join("; ") : null;
}
