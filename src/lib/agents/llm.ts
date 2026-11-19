import "server-only";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { z } from "zod";
import type { AnalysisReport, Validation } from "./types";
import { geminiModels, shouldTryNextModel } from "@/lib/gemini-models";

/**
 * Gemini is used for two things only: writing the narrative and acting as a sceptical second
 * reviewer. It never computes numbers or probabilities, and it can only DOWNGRADE a verdict.
 */

const TIMEOUT_MS = 25_000;

const ReviewSchema = z.object({
  narrative: z.string().describe("4–8 sentence plain-English research note for an Indian investor. Only use numbers present in the input."),
  concerns: z.array(z.string()).max(6).describe("Specific weaknesses, missing data or risks a sceptical investment committee would raise."),
  downgrade: z.boolean().describe("True only if the evidence does not justify the current verdict."),
  downgradeReason: z.string().describe("Why, if downgrade is true; otherwise empty."),
});

export type LlmReview = z.infer<typeof ReviewSchema>;

const SYSTEM = `You are the independent trade validator on an Indian equity research team (NSE/BSE).
Operating rules you must follow:
- Be objective, sceptical and evidence-driven. Never guarantee profits or claim a trade is risk-free.
- Use ONLY the numbers in the JSON you are given. Never invent prices, ratios, news, probabilities or sources.
- "NO TRADE" is a valid, successful outcome. Never argue for a trade the evidence does not support.
- You may recommend a downgrade of the verdict; you can never upgrade it.
- If the probability type is "unknown", say that the expected value cannot be established.
- Mention data that is missing (e.g. F&O, ownership flows) when it matters for the horizon.
- Do not present the system as a SEBI-registered adviser. Keep the note concise.`;

export function llmAvailable() {
  return Boolean(process.env.GEMINI_API_KEY);
}

/** Compact view of the report so the prompt stays small and factual. */
function brief(r: AnalysisReport) {
  return {
    instrument: r.instrument,
    horizon: r.request.horizon,
    price: r.price,
    marketRegime: r.marketRegime,
    verdict: r.validation,
    decision: r.decision,
    score: { total: r.score.total, band: r.score.band, coverage: r.score.coverage },
    agents: r.agents.map((a) => ({ agent: a.agent, status: a.status, score: a.score, bias: a.bias, summary: a.summary, warnings: a.warnings.slice(0, 3) })),
    conflicts: r.conflicts,
    expectedValue: r.expectedValue,
    risk: { approved: r.risk.approved, failedOrWarn: r.risk.checks.filter((c) => c.status !== "pass"), plan: r.risk.plan },
    validatorChecks: r.validator.checks.filter((c) => c.status !== "pass"),
    news: r.news.slice(0, 5).map((n) => ({ headline: n.headline, source: n.source, sentiment: n.sentiment, stale: n.stale })),
  };
}

export async function llmReview(report: AnalysisReport): Promise<LlmReview | null> {
  if (!llmAvailable()) return null;
  let lastError: unknown;
  for (const name of geminiModels()) {
    const model = new ChatGoogleGenerativeAI({ model: name, apiKey: process.env.GEMINI_API_KEY, temperature: 0.2, maxRetries: 1 });
    const structured = model.withStructuredOutput(ReviewSchema, { name: "trade_review" });
    try {
      return await structured.invoke(
        [
          ["system", SYSTEM],
          ["human", `Review this analysis and write the research note.\n\n${JSON.stringify(brief(report))}`],
        ],
        { signal: AbortSignal.timeout(TIMEOUT_MS) },
      );
    } catch (error) {
      lastError = error;
      if (!shouldTryNextModel(error)) break;
    }
  }
  console.error("[agent] Gemini review failed:", lastError instanceof Error ? lastError.message : lastError);
  return null;
}

/** One step down; never up. */
export function downgrade(v: Validation): Validation {
  if (v === "APPROVED") return "APPROVED WITH CONDITIONS";
  if (v === "APPROVED WITH CONDITIONS") return "NO TRADE";
  return v;
}

/** Deterministic narrative used when Gemini is not configured or fails. */
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
