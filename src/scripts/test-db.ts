/**
 * CRM repository tests against an embedded Postgres (PGlite) — no server needed.
 * Run: npm run test:db
 */
import { PGlite } from "@electric-sql/pglite";
import { SCHEMA } from "../lib/db/schema";
import { saveReport, claimAlert, listRecommendations, getRecommendation, openRecommendations, closeRecommendation } from "../lib/db/repo";
import type { AnalysisReport } from "../lib/agents/types";
let fail = 0; const ok = (c: boolean, m: string) => { if (!c) fail++; console.log(c ? "PASS" : "FAIL", m); };
(async () => {
  const pg = new PGlite();
  const db = { query: async (t: string, p: unknown[] = []) => (await pg.query(t, p as unknown[])).rows as never[] };
  for (const s of SCHEMA) await db.query(s);
  const base = (validation: AnalysisReport["validation"], decision: AnalysisReport["decision"], withPlan: boolean): AnalysisReport => ({
    id: null, version: null, persisted: false, createdAt: new Date().toISOString(),
    request: { symbol: "TCS", horizon: "swing", capital: null, riskPct: null },
    instrument: { symbol: "TCS.NS", name: "TCS", exchange: "NSE", sector: "IT", currency: "INR" },
    price: { value: 3000, timestamp: new Date().toISOString(), source: "test", marketOpen: false }, marketRegime: "x", decision, validation, headline: "h", executable: false,
    score: { total: 80, band: "b", weights: {} as never, components: [], coverage: 1 }, dataQuality: "good", agents: [], conflicts: [],
    expectedValue: { probabilityType: "unknown", pWin: null, avgWinPct: null, avgLossPct: null, expectancyPct: null, costsPct: 0.003, samples: 0, period: null, note: "" },
    risk: { approved: withPlan, capital: 1e5, riskPerTradePct: 1, illustrative: true, checks: [], plan: withPlan ? { instrument: "TCS.NS", direction: "long", entryLow: 2990, entryHigh: 3000, trigger: "t", stop: 2900, targets: [3200, 3300], riskReward: 2, quantity: 10, capitalRequired: 30000, maxLoss: 1000, estimatedCosts: 90, holdingPeriod: "h", invalidation: "i", illustrativeSizing: true } : null },
    validator: { verdict: validation, checks: [], conditions: [], llmConcerns: [], llmDowngraded: false }, scenarios: { bull: "", base: "", bear: "" },
    news: [], narrative: "", narrativeBy: "template", sources: [], disclaimers: [], stages: [],
  });
  const a = await saveReport(base("APPROVED", "BUY", true), 0.003, db);
  ok(a.persisted && a.version === 1 && a.alert === "new", `first APPROVED → new rec v1, alert "new" (${a.id})`);
  const b = await saveReport(base("APPROVED", "BUY", true), 0.003, db);
  ok(b.id === a.id && b.version === 2 && b.alert === null, "same verdict again → v2 of the SAME rec, no alert (no duplicate email)");
  const c = await saveReport(base("NO TRADE", "NO TRADE", false), 0.003, db);
  ok(c.id === a.id && c.version === 3 && c.alert === "invalidated", "APPROVED → NO TRADE → v3, alert \"invalidated\"");
  ok(await claimAlert(a.id!, 1, "new", db), "claim alert first time → true");
  ok(!(await claimAlert(a.id!, 1, "new", db)), "claim same alert again → false (dedupe)");
  const list = await listRecommendations(10, db);
  ok(list?.length === 1 && list[0].versions === 3 && list[0].validation === "NO TRADE", "history lists 1 rec with 3 versions, latest NO TRADE");
  const g = await getRecommendation(a.id!, db);
  ok(g?.versions.length === 3 && g.report.version === 3 && g.report.persisted, "detail returns all 3 versions; latest report embedded");
  const d = await saveReport({ ...base("APPROVED WITH CONDITIONS", "WATCHLIST", true), request: { symbol: "INFY", horizon: "swing", capital: null, riskPct: null }, instrument: { symbol: "INFY.NS", name: "Infosys", exchange: "NSE", sector: "IT", currency: "INR" } }, 0.003, db);
  ok(d.alert === null && d.version === 1, "WATCHLIST is stored but does not trigger an immediate email");
  const open = await openRecommendations(db);
  ok(open.some((o) => o.id === d.id), "WATCHLIST with a plan is tracked as open (rejected/conditional calls tracked too)");
  await closeRecommendation(d.id!, "target-hit", 6.37, new Date(), db);
  const after = await listRecommendations(10, db);
  const inf = after?.find((r) => r.id === d.id);
  ok(inf?.status === "target-hit" && inf.outcomeReturnPct === 6.37, "outcome recorded: target-hit +6.37%");
  const audit = (await db.query("select count(*)::int as n from audit_log")) as unknown as Array<{ n: number }>;
  ok(audit[0].n >= 5, `audit log has ${audit[0].n} entries`);
  console.log(fail ? `\n${fail} FAILED` : "\nALL DB TESTS PASS");
  process.exit(fail ? 1 : 0);
})();
