import { PGlite } from "@electric-sql/pglite";
import { aggregate, chartVerdict, combinedScore, insiderScore, isInsider, isMarketTrade, parseDisclosureXml, qualifies } from "../lib/insider/core";
import { setDbForTesting } from "../lib/db/client";
import { SCHEMA } from "../lib/db/schema";
import { insiderFor, latestScreen, parseNseTime, runInsiderScreen, trackRecord, type InsiderScreen } from "../lib/insider/run";

// npm run test:insider — the NSE insider-trading strategy: XBRL parsing, filters, scoring, chart
// verdicts, then a live run against NSE in an in-memory database.

let failed = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  (${extra})` : ""}`);
};

const fact = (ctx: string, name: string, v: string | number) => `<in-bse-co:${name} contextRef="${ctx}" decimals="INF">${v}</in-bse-co:${name}>`;
const disclosure = (ctx: string, o: { person: string; category: string; type: string; mode: string; qty: number; value: number; pre: number; post: number; date: string }) =>
  [
    fact(ctx, "TypeOfInstrument", "Equity"),
    fact(ctx, "CategoryOfPerson", o.category),
    fact(ctx, "NameOfThePerson", o.person),
    fact(ctx, "SecuritiesHeldPriorToAcquisitionOrDisposalPercentageOfShareholding", o.pre),
    fact(ctx, "SecuritiesAcquiredOrDisposedNumberOfSecurity", o.qty),
    fact(ctx, "SecuritiesAcquiredOrDisposedValueOfSecurity", o.value),
    fact(ctx, "SecuritiesAcquiredOrDisposedTransactionType", o.type),
    fact(ctx, "SecuritiesHeldPostAcquistionOrDisposalPercentageOfShareholding", o.post),
    fact(ctx, "DateOfAllotmentAdviceOrAcquisitionOfSharesOrSaleOfSharesSpecifyFromDate", o.date),
    fact(ctx, "DateOfAllotmentAdviceOrAcquisitionOfSharesOrSaleOfSharesSpecifyToDate", o.date),
    fact(ctx, "ModeOfAcquisitionOrDisposal", o.mode),
  ].join("\n");

const XML = `<?xml version="1.0"?><xbrli:xbrl>
<in-bse-co:Symbol contextRef="MainI">ACME</in-bse-co:Symbol>
<in-bse-co:NameOfTheCompany contextRef="MainI">ACME LIMITED</in-bse-co:NameOfTheCompany>
${disclosure("Disclosure1", { person: "A Promoter", category: "Promoter", type: "Buy", mode: "Market Purchase", qty: 10000, value: 5_000_000, pre: 0.42, post: 0.425, date: "2026-11-20" })}
${disclosure("Disclosure2", { person: "B Director", category: "Promoter and Director", type: "Buy", mode: "Market Purchase", qty: 2000, value: 1_000_000, pre: 0.01, post: 0.012, date: "2026-11-21" })}
${disclosure("Disclosure3", { person: "ESOP Trust", category: "Other", type: "Sell", mode: "Market Sale", qty: 500, value: 250_000, pre: 0.001, post: 0.0009, date: "2026-11-21" })}
${disclosure("Disclosure4", { person: "C KMP", category: "KMP", type: "Buy", mode: "ESOP", qty: 300, value: 90_000, pre: 0, post: 0.0001, date: "2026-11-21" })}
${disclosure("Disclosure5", { person: "D Promoter", category: "Promoter Group", type: "Pledge", mode: "Pledge Creation", qty: 1, value: 0, pre: 0.1, post: 0.1, date: "2026-11-21" })}
</xbrli:xbrl>`;

const txns = parseDisclosureXml(XML, { appId: "1", symbol: "ACME", company: "Acme", disclosedAt: "2026-11-22T12:00:00.000Z" });
check("parses every disclosure context", txns.length === 5, String(txns.length));
check("reads symbol and company from the filing", txns[0].symbol === "ACME" && txns[0].company === "ACME LIMITED");
const a = txns.find((t) => t.person === "A Promoter")!;
check("fields: value, type, mode, dates", a.value === 5_000_000 && a.type === "Buy" && a.mode === "Market Purchase" && a.toDate === "2026-11-20");
check("fractional stake converted to percent", Math.abs((a.postPct ?? 0) - 42.5) < 1e-9 && Math.abs((a.prePct ?? 0) - 42) < 1e-9, `${a.prePct} → ${a.postPct}`);

check("promoter / director / KMP count as insiders", isInsider({ category: "Promoter Group" }) && isInsider({ category: "Promoter and Director" }) && isInsider({ category: "KMP" }) && isInsider({ category: "Director" }));
check("ESOP trusts, employees and 'Other' do not", !isInsider({ category: "Other" }) && !isInsider({ category: "Employee" }) && !isInsider({ category: "Trust" }));
check("only open-market trades count", isMarketTrade({ mode: "Market Purchase" }) && isMarketTrade({ mode: "Market Sale" }) && isMarketTrade({ mode: "Block Deal" }) && !isMarketTrade({ mode: "ESOP" }) && !isMarketTrade({ mode: "Gift" }) && !isMarketTrade({ mode: "Inter-se-Transfer" }) && !isMarketTrade({ mode: "Pledge Creation" }));
check("qualifying trades: the two promoter market purchases only", txns.filter(qualifies).map((t) => t.person).join(",") === "A Promoter,B Director", txns.filter(qualifies).map((t) => t.person).join(","));

const [acme] = aggregate(txns);
check("aggregate: net bought ₹60 lakh by 2 insiders", acme.netValue === 6_000_000 && acme.buyers === 2 && acme.sellers === 0 && acme.promoterBuy, JSON.stringify({ net: acme.netValue, buyers: acme.buyers }));
check("aggregate: stake added in percentage points", Math.abs(acme.stakeAddedPct - 0.7) < 1e-9, acme.stakeAddedPct.toFixed(3));
check("insider score rewards size and breadth", insiderScore({ netValue: 5e7, buyers: 4, sellers: 0, promoterBuy: true, stakeAddedPct: 1 }) > insiderScore({ netValue: 5e5, buyers: 1, sellers: 0, promoterBuy: false, stakeAddedPct: 0 }));
check("net sellers score 0", insiderScore({ netValue: -1e6, buyers: 1, sellers: 2, promoterBuy: false, stakeAddedPct: 0 }) === 0);
const sellers = aggregate([...txns, { ...a, appId: "2", person: "Big Seller", type: "Sell", mode: "Market Sale", value: 20_000_000 }]);
check("a big promoter sale makes the stock a net seller", sellers[0].direction === "selling" && sellers[0].insiderScore === 0);

check("chart: bullish structure with room → ready", chartVerdict({ structure: "bullish", toResistanceAtr: 2, toSupportAtr: 0.8, belowFalling200: false, bullishPattern: false }).verdict === "ready");
check("chart: right under resistance → wait", chartVerdict({ structure: "bullish", toResistanceAtr: 0.3, toSupportAtr: 2, belowFalling200: false, bullishPattern: false }).verdict === "wait");
check("chart: bearish structure → avoid", chartVerdict({ structure: "bearish", toResistanceAtr: 3, toSupportAtr: 1, belowFalling200: false, bullishPattern: true }).verdict === "avoid");
check("combined score weights insider 60 / chart 40", combinedScore(80, 50) === 68);
check("NSE broadcast time → ISO (IST)", parseNseTime("25-Nov-2026 18:03:11") === "2026-11-25T12:33:11.000Z", parseNseTime("25-Nov-2026 18:03:11"));

const fake = (day: string, picks: Array<{ next: number | null; after5: number | null }>): InsiderScreen => ({ day, createdAt: day, filings: 1, fetchedNow: 0, errors: [], buying: [], selling: [], outcome: { scoredAt: day, picks: picks.map((p, i) => ({ symbol: `S${i}`, entry: 100, ...p })) } });
const tr = trackRecord([fake("2026-11-01", [{ next: 1, after5: 4 }, { next: -1, after5: -2 }]), fake("2026-11-02", [{ next: 2, after5: null }])]);
check("track record averages and hit rates", tr.picks === 3 && Math.abs((tr.nextAvg ?? 0) - 2 / 3) < 1e-9 && tr.after5Hit === 0.5, JSON.stringify(tr));

(async () => {
  // Live: the real NSE pipeline into an in-memory Postgres.
  const pg = new PGlite();
  const db = { query: async <T,>(t: string, p: unknown[] = []) => (await pg.query(t, p as unknown[])).rows as T[] };
  for (const s of SCHEMA) await db.query(s);
  setDbForTesting(db);
  try {
    const t0 = Date.now();
    const screen = await runInsiderScreen();
    const ready = screen.buying.filter((p) => p.chart.verdict === "ready");
    check("live: NSE list and XBRL files fetched", screen.filings > 0 && screen.fetchedNow > 0, `${screen.filings} disclosures, ${screen.fetchedNow} fetched in ${((Date.now() - t0) / 1000).toFixed(0)}s, errors: ${screen.errors.length}`);
    check("live: insider buying stocks found and chart-checked", screen.buying.length > 0 && screen.buying.every((p) => p.chart.verdict !== undefined), `${screen.buying.length} buying, ${ready.length} ready`);
    for (const p of screen.buying.slice(0, 10)) console.log(`      ${String(p.rank).padStart(3)}  ${p.symbol.padEnd(12)} net ₹${(p.netValue / 1e5).toFixed(1)} L  ${p.buyers} insider(s)  insider ${p.insiderScore}  chart ${p.chart.verdict} (${p.chart.structure ?? "—"})  ${p.chart.reasons[0] ?? ""}`);
    const again = await runInsiderScreen();
    check("live: second run downloads nothing new (cached)", again.fetchedNow <= 3, `fetched ${again.fetchedNow}`);
    check("live: screen saved and readable", (await latestScreen())?.day === screen.day);
    if (screen.buying[0]) {
      const one = await insiderFor(`${screen.buying[0].symbol}.NS`);
      check("live: agents can look up one stock's insider trades", one != null && one.symbol === screen.buying[0].symbol);
    }
  } catch (e) {
    console.log(`SKIP  live NSE run: ${e instanceof Error ? e.message : e}`);
  }
  console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
  process.exit(failed ? 1 : 0);
})();
