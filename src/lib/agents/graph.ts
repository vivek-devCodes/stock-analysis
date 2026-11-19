import "server-only";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { claimAlert, markAlert, saveReport, type AlertKind } from "../db/repo";
import { sendSignalEmail } from "../email-service";
import { collectData, normaliseSymbol, validateData, type DataSnapshot } from "./data";
import { detectConflicts, expectedValue, finalDecision, headlineFor, proposedDirection, riskAgent, scenarios, scoreAll, validate } from "./decision";
import { downgrade, llmReview, templateNarrative } from "./llm";
import { CALIBRATION_META, fnoAgent, fundamentalAgent, marketAgent, newsAgent, ownershipAgent, quantAgent, technicalAgent } from "./specialists";
import type { AgentId, AgentResult, AnalysisReport, Conflict, ExpectedValue, Horizon, NewsItemRef, RiskReview, ScoreBreakdown, ValidatorReport } from "./types";

/**
 * Master orchestrator (spec §3 agent 1, §5 decision engine) as a LangGraph state graph:
 *
 *   collect ─┬─ market ──────┐
 *         ├─ technical ───┤
 *         ├─ fundamental ─┤
 *         ├─ news ────────┼─ conflicts → risk → validate → assemble → review → persist → END
 *         ├─ ownership ───┤
 *         ├─ fno ─────────┤
 *         └─ quant ───────┘
 *   (data validation failure skips straight to assemble → INSUFFICIENT DATA)
 */

type Stage = AnalysisReport["stages"][number];
type Cal = ReturnType<typeof quantAgent>["cal"];

const State = Annotation.Root({
  request: Annotation<{ symbol: string; horizon: Horizon; capital: number | null; riskPct: number | null }>(),
  data: Annotation<DataSnapshot | null>({ reducer: (_a, b) => b, default: () => null }),
  dataOk: Annotation<boolean>({ reducer: (_a, b) => b, default: () => false }),
  dataProblems: Annotation<string[]>({ reducer: (_a, b) => b, default: () => [] }),
  dataWarnings: Annotation<string[]>({ reducer: (_a, b) => b, default: () => [] }),
  agents: Annotation<AgentResult[]>({ reducer: (a, b) => [...a, ...b], default: () => [] }),
  regimeLabel: Annotation<string>({ reducer: (_a, b) => b, default: () => "Unknown" }),
  newsItems: Annotation<NewsItemRef[]>({ reducer: (_a, b) => b, default: () => [] }),
  cal: Annotation<Cal>({ reducer: (_a, b) => b, default: () => null }),
  conflicts: Annotation<Conflict[]>({ reducer: (_a, b) => b, default: () => [] }),
  score: Annotation<ScoreBreakdown | null>({ reducer: (_a, b) => b, default: () => null }),
  ev: Annotation<ExpectedValue | null>({ reducer: (_a, b) => b, default: () => null }),
  risk: Annotation<RiskReview | null>({ reducer: (_a, b) => b, default: () => null }),
  validator: Annotation<ValidatorReport | null>({ reducer: (_a, b) => b, default: () => null }),
  report: Annotation<AnalysisReport | null>({ reducer: (_a, b) => b, default: () => null }),
  stages: Annotation<Stage[]>({ reducer: (a, b) => [...a, ...b], default: () => [] }),
});
type S = typeof State.State;

const SPECIALISTS: AgentId[] = ["market", "technical", "fundamental", "news", "ownership", "fno", "quant"];
const t0 = () => Date.now();
const stage = (name: string, start: number, status: Stage["status"], detail: string): Stage => ({ stage: name, status, detail, ms: Date.now() - start });
const marketOpenOf = (d: DataSnapshot | null) => d?.live?.marketState === "REGULAR";

/* ------------------------------------------- nodes ------------------------------------------- */

async function dataNode(s: S): Promise<Partial<S>> {
  const start = t0();
  const data = await collectData(s.request.symbol, s.request.horizon);
  const v = validateData(data);
  return {
    data,
    dataOk: v.ok,
    dataProblems: v.problems,
    dataWarnings: v.warnings,
    stages: [stage("Data validation", start, v.ok ? "done" : "failed", v.ok ? `${data.daily.length} daily candles, quote ${data.live ? data.live.source : "unavailable"}; ${v.warnings.length} warning(s).` : v.problems.join(" "))],
  };
}

function specialist(id: AgentId) {
  return async (s: S): Promise<Partial<S>> => {
    const start = t0();
    const d = s.data!;
    if (id === "market") {
      const r = marketAgent(d);
      return { agents: [r], regimeLabel: r.regimeLabel, stages: [stage("Market context", start, r.status === "ok" ? "done" : "skipped", r.summary)] };
    }
    if (id === "news") {
      const { items, ...r } = newsAgent(d);
      return { agents: [r], newsItems: items };
    }
    if (id === "quant") {
      const { cal, side: _side, ...r } = quantAgent(d);
      void _side;
      return { agents: [r], cal };
    }
    const r = id === "technical" ? technicalAgent(d) : id === "fundamental" ? fundamentalAgent(d) : id === "ownership" ? ownershipAgent(d) : fnoAgent(d);
    return { agents: [r] };
  };
}

async function conflictsNode(s: S): Promise<Partial<S>> {
  const start = t0();
  const dir = proposedDirection(s.request.horizon, s.agents.find((a) => a.agent === "technical"), s.agents.find((a) => a.agent === "fundamental"));
  const conflicts = detectConflicts(s.agents, s.request.horizon);
  const score = scoreAll(s.agents, s.request.horizon, dir);
  return {
    conflicts,
    score,
    ev: expectedValue(s.cal, s.request.horizon),
    stages: [
      stage("Specialist agents", start, "done", `${s.agents.filter((a) => a.status === "ok").length}/${SPECIALISTS.length} agents had the data they needed.`),
      stage("Conflict detection", start, "done", conflicts.length ? `${conflicts.length} conflict(s), ${conflicts.filter((c) => c.severity === "material").length} material.` : "No conflicts."),
      stage("Expected value", start, "done", s.cal ? "Backtested probability available." : "Probability unknown — not estimated."),
    ],
  };
}

async function riskNode(s: S): Promise<Partial<S>> {
  const start = t0();
  const dir = proposedDirection(s.request.horizon, s.agents.find((a) => a.agent === "technical"), s.agents.find((a) => a.agent === "fundamental"));
  const risk = riskAgent(s.data!, dir, s.request.capital, s.request.riskPct, marketOpenOf(s.data));
  return { risk, stages: [stage("Risk approval", start, "done", risk.approved ? "Risk agent approved the trade plan." : "Risk agent rejected or found no plan.")] };
}

async function validateNode(s: S): Promise<Partial<S>> {
  const start = t0();
  const get = (id: AgentId) => s.agents.find((a) => a.agent === id)!;
  const validator = validate({
    dataOk: s.dataOk,
    dataWarnings: s.dataWarnings,
    horizon: s.request.horizon,
    direction: proposedDirection(s.request.horizon, get("technical"), get("fundamental")),
    technical: get("technical"),
    fundamental: get("fundamental"),
    market: get("market"),
    news: get("news"),
    conflicts: s.conflicts,
    ev: s.ev!,
    provenEvidence: s.cal ? (s.cal as { proven: boolean }).proven : null,
    risk: s.risk!,
    score: s.score!,
  });
  return { validator, stages: [stage("Independent validation", start, "done", `Verdict: ${validator.verdict}.`)] };
}

async function assembleNode(s: S): Promise<Partial<S>> {
  const start = t0();
  const d = s.data;
  const symbol = d?.symbol ?? normaliseSymbol(s.request.symbol);
  const dir = proposedDirection(s.request.horizon, s.agents.find((a) => a.agent === "technical"), s.agents.find((a) => a.agent === "fundamental"));
  const verdict = s.dataOk ? s.validator!.verdict : "INSUFFICIENT DATA";
  const decision = finalDecision(verdict, s.request.horizon, dir);
  const emptyScore: ScoreBreakdown = { total: null, band: "Not scored", weights: { market: 0, technical: 0, fundamental: 0, news: 0, ownership: 0, fno: 0, quant: 0 }, components: [], coverage: 0 };
  const priceTs = d?.live ? new Date(d.live.time * 1000).toISOString() : d?.daily.length ? new Date(d.daily.at(-1)!.time * 1000).toISOString() : null;
  const coverage = s.score?.coverage ?? 0;
  const report: AnalysisReport = {
    id: null,
    version: null,
    persisted: false,
    createdAt: new Date().toISOString(),
    request: s.request,
    instrument: { symbol, name: d?.name ?? symbol, exchange: d?.exchange ?? "NSE", sector: d?.sector ?? "—", currency: d?.currency ?? "INR" },
    price: { value: d?.live?.price ?? d?.daily.at(-1)?.close ?? null, timestamp: priceTs, source: d?.live?.source ?? "Last daily close", marketOpen: marketOpenOf(d) },
    marketRegime: s.regimeLabel,
    decision,
    validation: verdict,
    headline: headlineFor(decision, verdict, symbol, dir, s.request.horizon),
    executable: verdict === "APPROVED" && (s.request.horizon !== "intraday" || marketOpenOf(d)),
    score: s.score ?? emptyScore,
    dataQuality: !s.dataOk ? "poor" : coverage >= 0.75 ? "good" : coverage >= 0.5 ? "partial" : "poor",
    agents: [...s.agents].sort((a, b) => SPECIALISTS.indexOf(a.agent) - SPECIALISTS.indexOf(b.agent)),
    conflicts: s.conflicts,
    expectedValue: s.ev ?? expectedValue(null, s.request.horizon),
    risk: s.risk ?? { approved: false, capital: s.request.capital ?? 0, riskPerTradePct: s.request.riskPct ?? 0, illustrative: true, checks: [], plan: null },
    validator: s.validator ?? { verdict: "INSUFFICIENT DATA", checks: s.dataProblems.map((p) => ({ name: "Data validation", status: "fail" as const, detail: p })), conditions: [], llmConcerns: [], llmDowngraded: false },
    scenarios: d && s.dataOk ? scenarios(d) : { bull: "—", base: "—", bear: "—" },
    news: s.newsItems,
    narrative: "",
    narrativeBy: "template",
    sources: d?.sources ?? [],
    disclaimers: [
      "Research output, not personalised investment advice. Apex Desk is not a SEBI-registered investment adviser or research analyst.",
      "No order is placed by this system. Past and backtested results do not guarantee future returns.",
      "NSE/BSE prices may be delayed when NSE's live feed is unavailable; each price shows its source and timestamp.",
    ],
    stages: [],
  };
  return { report, stages: [stage("Final decision", start, s.dataOk ? "done" : "failed", `${decision} (${verdict}).`)] };
}

async function reviewNode(s: S): Promise<Partial<S>> {
  const start = t0();
  const report = { ...s.report! };
  if (!s.dataOk) {
    report.narrative = templateNarrative(report);
    return { report, stages: [stage("LLM review", start, "skipped", "Data validation failed.")] };
  }
  const review = await llmReview(report);
  if (!review) {
    report.narrative = templateNarrative(report);
    return { report, stages: [stage("LLM review", start, "skipped", process.env.GEMINI_API_KEY ? "Gemini call failed — template narrative used." : "GEMINI_API_KEY not set — template narrative used.")] };
  }
  report.narrative = review.narrative;
  report.narrativeBy = "gemini";
  const validator = { ...report.validator, llmConcerns: review.concerns };
  if (review.downgrade) {
    const v = downgrade(report.validation);
    if (v !== report.validation) {
      validator.llmDowngraded = true;
      validator.conditions = [...validator.conditions, `Reviewer downgrade: ${review.downgradeReason}`];
      report.validation = v;
      validator.verdict = v;
      report.decision = finalDecision(v, report.request.horizon, proposedDirection(report.request.horizon, report.agents.find((a) => a.agent === "technical"), report.agents.find((a) => a.agent === "fundamental")));
      report.headline = headlineFor(report.decision, v, report.instrument.symbol, proposedDirection(report.request.horizon, report.agents.find((a) => a.agent === "technical"), report.agents.find((a) => a.agent === "fundamental")), report.request.horizon);
      report.executable = v === "APPROVED" && report.executable;
    }
  }
  report.validator = validator;
  return { report, stages: [stage("LLM review", start, "done", review.downgrade ? "Gemini reviewer downgraded the verdict." : `Gemini reviewer raised ${review.concerns.length} concern(s).`)] };
}

async function persistNode(s: S): Promise<Partial<S>> {
  const start = t0();
  const report = { ...s.report!, stages: s.stages };
  const costRate = s.request.horizon === "intraday" ? 0.001 : CALIBRATION_META.costRoundTrip;
  let saved;
  try {
    saved = await saveReport(report, costRate);
  } catch (e) {
    console.error("[agent] persist failed:", e);
    saved = { persisted: false, id: null, version: null, alert: null };
  }
  report.id = saved.id;
  report.version = saved.version;
  report.persisted = saved.persisted;
  const stages: Stage[] = [stage("Save to CRM", start, saved.persisted ? "done" : "skipped", saved.persisted ? `${saved.id} v${saved.version}` : "No DATABASE_URL — history not kept.")];
  if (saved.persisted && saved.id && saved.version && saved.alert) stages.push(await notify(report, saved.id, saved.version, saved.alert));
  report.stages = [...report.stages, ...stages];
  return { report, stages };
}

async function notify(r: AnalysisReport, id: string, version: number, kind: AlertKind): Promise<Stage> {
  const start = t0();
  if (!(await claimAlert(id, version, kind))) return stage("Email alert", start, "skipped", "Already sent for this version.");
  const p = r.risk.plan;
  const date = new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
  const label = kind === "invalidated" ? "INVALIDATED" : kind === "changed" ? "CHANGED" : "TRADE SIGNAL";
  const f = (x: number) => x.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  const res = await sendSignalEmail({
    subject: `[${label}] ${r.instrument.symbol} – ${r.request.horizon} ${r.decision} – ${date}`,
    lines: [
      ["Instrument", `${r.instrument.name} (${r.instrument.symbol}, ${r.instrument.exchange})`],
      ["Horizon", r.request.horizon],
      ["Decision", `${r.decision} — ${r.validation}`],
      ["Verified price", r.price.value != null ? `${f(r.price.value)} (${r.price.source}, ${r.price.timestamp ?? "—"})` : "—"],
      ...(p
        ? ([
            ["Entry trigger", p.trigger],
            ["Entry zone", `${f(p.entryLow)} – ${f(p.entryHigh)}`],
            ["Stop-loss", f(p.stop)],
            ["Targets", p.targets.map(f).join(" / ")],
            ["Risk : reward", p.riskReward ? `1 : ${p.riskReward.toFixed(2)}` : "—"],
            ["Position size", `${p.quantity} shares${p.illustrativeSizing ? " (illustrative sizing)" : ""}`],
            ["Maximum estimated loss", `₹${Math.round(p.maxLoss).toLocaleString("en-IN")}`],
            ["Validity", p.holdingPeriod],
          ] as Array<[string, string]>)
        : []),
      ["Score", `${r.score.total ?? "—"}/100 — ${r.score.band}`],
      ["Data timestamp", r.price.timestamp ?? "—"],
      ["Recommendation", `${id} v${version}`],
    ],
    notes: [r.headline, ...r.validator.conditions, ...r.disclaimers],
  });
  await markAlert(id, version, kind, res.success ? "sent" : "failed", res.error ?? "ok");
  return stage("Email alert", start, res.success ? "done" : "failed", res.success ? `${label} email sent.` : `Email failed: ${res.error}`);
}

/* ------------------------------------------- graph ------------------------------------------- */

const builder = new StateGraph(State)
  .addNode("collect", dataNode)
  .addNode("market", specialist("market"))
  .addNode("technical", specialist("technical"))
  .addNode("fundamental", specialist("fundamental"))
  .addNode("news", specialist("news"))
  .addNode("ownership", specialist("ownership"))
  .addNode("fno", specialist("fno"))
  .addNode("quant", specialist("quant"))
  .addNode("detect_conflicts", conflictsNode)
  .addNode("risk_check", riskNode)
  .addNode("validate", validateNode)
  .addNode("assemble", assembleNode)
  .addNode("review", reviewNode)
  .addNode("persist", persistNode)
  .addEdge(START, "collect")
  .addConditionalEdges("collect", (s: S) => (s.dataOk ? SPECIALISTS : ["assemble"]), [...SPECIALISTS, "assemble"])
  .addEdge(["market", "technical", "fundamental", "news", "ownership", "fno", "quant"], "detect_conflicts")
  .addEdge("detect_conflicts", "risk_check")
  .addEdge("risk_check", "validate")
  .addEdge("validate", "assemble")
  .addEdge("assemble", "review")
  .addEdge("review", "persist")
  .addEdge("persist", END);

const graph = builder.compile();

export async function runAnalysis(input: { symbol: string; horizon: Horizon; capital?: number | null; riskPct?: number | null }): Promise<AnalysisReport> {
  const out = await graph.invoke({
    request: { symbol: input.symbol, horizon: input.horizon, capital: input.capital ?? null, riskPct: input.riskPct ?? null },
  });
  return out.report!;
}
