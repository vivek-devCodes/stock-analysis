import "server-only";
import type { AnalysisReport, Validation } from "./types";

// Rule-based narrative and verdict helpers. The app uses no external AI service: every report is
// written from the agents' own evidence, so nothing depends on an API key.

/** One step down; never up. */
export function downgrade(v: Validation): Validation {
  if (v === "APPROVED") return "APPROVED WITH CONDITIONS";
  if (v === "APPROVED WITH CONDITIONS") return "NO TRADE";
  return v;
}

/** Deterministic narrative written from the agents' evidence. */
export function templateNarrative(r: AnalysisReport): string {
  const parts: string[] = [];
  parts.push(`${r.instrument.name} (${r.instrument.symbol}) on the ${r.request.horizon} horizon: ${r.headline}`);
  parts.push(`Market regime: ${r.marketRegime}. Combined score ${r.score.total ?? "—"}/100 (${r.score.band}), using ${(r.score.coverage * 100).toFixed(0)}% of the intended evidence weight.`);
  const tech = r.agents.find((a) => a.agent === "technical");
  if (tech) parts.push(tech.summary);
  const quant = r.agents.find((a) => a.agent === "quant");
  if (quant) parts.push(quant.summary);
  if (r.conflicts.length) parts.push(`Conflicts: ${r.conflicts.map((c) => c.description).join(" ")}`);
  const fails = r.validator.checks.filter((c) => c.status === "fail").map((c) => c.name.toLowerCase());
  if (fails.length) parts.push(`The validator did not pass: ${fails.join(", ")}.`);
  parts.push("Derivatives and institutional-flow data are not connected, so those dimensions were not assessed.");
  return parts.join(" ");
}
