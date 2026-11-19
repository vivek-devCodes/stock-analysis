/**
 * Exchange-data pipeline + next-session plan tests. Pure functions, a hand-built ZIP, and the SQL
 * (exchange store, plans, reports) against an embedded Postgres (PGlite) — no network.
 * Run: npm run test:exchange
 */
import { PGlite } from "@electric-sql/pglite";
import { deflateRawSync } from "node:zlib";
import { setDbForTesting } from "../lib/db/client";
import { SCHEMA } from "../lib/db/schema";
import { assembleDay } from "../lib/exchange/build";
import { unzipFirst } from "../lib/exchange/fetch";
import { buildFnoSummaries, classifyBuildup, maxPain } from "../lib/exchange/fno";
import { bsPrice, greeks, impliedVol } from "../lib/exchange/greeks";
import { interpretMarket, interpretStock, netDirection } from "../lib/exchange/interpret";
import { isoDate, parseBan, parseBhav, parseCsv, parseDeals, parseFoBhav, parseLots, parseParticipants, parseSecList } from "../lib/exchange/parse";
import type { StockDay } from "../lib/exchange/types";
import { claimPendingPlan, finishPlan, getPlan, listDailyReports, planExecutedOn, saveDailyReport, savePlan } from "../lib/paper/plan-store";
import { headlineFor, group } from "../lib/paper/report";
import { planEntry, sizeFor } from "../lib/paper/rules";
import type { PaperTrade, SessionPlan } from "../lib/paper/types";

let fail = 0;
const ok = (c: boolean, m: string) => {
  if (!c) fail += 1;
  console.log(c ? "PASS" : "FAIL", m);
};
const near = (a: number | null | undefined, b: number, tol: number) => a != null && Math.abs(a - b) <= tol;

/* ------------------------------------------------ fixtures ------------------------------------------------ */

const BHAV = `SYMBOL, SERIES, DATE1, PREV_CLOSE, OPEN_PRICE, HIGH_PRICE, LOW_PRICE, LAST_PRICE, CLOSE_PRICE, AVG_PRICE, TTL_TRD_QNTY, TURNOVER_LACS, NO_OF_TRADES, DELIV_QTY, DELIV_PER
UPCO, EQ, 18-Nov-2026, 100.00, 100.00, 106.00, 99.50, 105.00, 105.00, 103.00, 2000000, 2060.00, 9000, 1400000, 70.00
DOWNCO, EQ, 18-Nov-2026, 200.00, 199.00, 200.00, 190.00, 191.00, 190.00, 194.00, 500000, 970.00, 3000, 300000, 60.00
T2TCO, BE, 18-Nov-2026, 50.00, 50.00, 52.50, 50.00, 52.50, 52.50, 52.00, 10000, 5.20, 40, -, -
GSMCO, EQ, 18-Nov-2026, 10.00, 10.00, 10.20, 9.90, 10.10, 10.10, 10.00, 1000, 0.10, 10, 900, 90.00
BONDX, N1, 18-Nov-2026, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1, 0.01, 1, -, -
`;
const SECLIST = `Symbol,Series,Security Name,Band,Remarks
UPCO,EQ,UP CO LTD,No Band,"-"
DOWNCO,EQ,DOWN CO LTD,10,"-"
T2TCO,BE,T2T CO,5,"-"
GSMCO,EQ,GSM CO,5,"GSM STAGE - I"
`;
const BAN = `Securities in Ban For Trade Date 19-NOV-2026:
1,UPCO
`;
const BULK = `Date,Symbol,Security Name,Client Name,Buy/Sell,Quantity Traded,Trade Price / Wght. Avg. Price,Remarks
18-NOV-2026,UPCO,Up Co Ltd,BIG FUND LLP,BUY,500000,104.50,-
18-NOV-2026,UPCO,Up Co Ltd,HFT DESK,BUY,90000,104.00,-
18-NOV-2026,UPCO,Up Co Ltd,HFT DESK,SELL,90000,104.10,-
`;
const LOTS = `UNDERLYING                          ,SYMBOL    ,NOV-26     ,DEC-26
Symbol,Symbol,,
UP CO LTD                           ,UPCO      ,500        ,500
`;
const POI = `""Participant wise Open Interest (no. of contracts) in Equity Derivatives as on Nov 18, 2026"",,,,
Client Type,Future Index Long,Future Index Short,Future Stock Long,Future Stock Short
Client,100,50,10,10
FII,30,70,10,10
TOTAL,130,120,20,20
`;
const FO_HEAD = "TradDt,BizDt,Sgmt,Src,FinInstrmTp,FinInstrmId,ISIN,TckrSymb,SctySrs,XpryDt,FininstrmActlXpryDt,StrkPric,OptnTp,FinInstrmNm,OpnPric,HghPric,LwPric,ClsPric,LastPric,PrvsClsgPric,UndrlygPric,SttlmPric,OpnIntrst,ChngInOpnIntrst,TtlTradgVol,TtlTrfVal,TtlNbOfTxsExctd,SsnId,NewBrdLotQty,Rmks,Rsvd1,Rsvd2,Rsvd3,Rsvd4";
const fo = (tp: string, sym: string, exp: string, strike: string, opt: string, close: number, prev: number, und: number, oi: number, chg: number) =>
  `2026-11-18,2026-11-18,FO,NSE,${tp},1,,${sym},,${exp},${exp},${strike},${opt},X,0,0,0,${close},${close},${prev},${und},${close},${oi},${chg},10,1000,1,F1,500,,,,,`;
const FO = [
  FO_HEAD,
  fo("STF", "UPCO", "2026-11-26", "", "", 105.5, 100.2, 105, 1_100_000, 100_000), // price up, OI up → long build-up
  fo("STF", "UPCO", "2026-12-31", "", "", 106, 101, 105, 100_000, 0),
  fo("STO", "UPCO", "2026-11-26", "100.00", "CE", 6.2, 3, 105, 50_000, 0),
  fo("STO", "UPCO", "2026-11-26", "100.00", "PE", 0.6, 1.5, 105, 400_000, 50_000),
  fo("STO", "UPCO", "2026-11-26", "105.00", "CE", 2.6, 1.2, 105, 200_000, 20_000),
  fo("STO", "UPCO", "2026-11-26", "105.00", "PE", 2.2, 3, 105, 300_000, 10_000),
  fo("STO", "UPCO", "2026-11-26", "110.00", "CE", 0.8, 0.5, 105, 600_000, 60_000),
  fo("STO", "UPCO", "2026-11-26", "110.00", "PE", 5.6, 8, 105, 20_000, 0),
].join("\n");

/* ------------------------------------------------ parsing ------------------------------------------------ */

ok(JSON.stringify(parseCsv('a,"b,c",d\r\n"x ""y""",2,\n')) === JSON.stringify([["a", "b,c", "d"], ['x "y"', "2", ""]]), "CSV: quoted commas, doubled quotes, CRLF, empty last cell");
ok(isoDate("18-Nov-2026") === "2026-11-18" && isoDate("18-NOV-26") === "2026-11-18" && isoDate("18-11-2026") === "2026-11-18" && isoDate("2026-11-18") === "2026-11-18", "isoDate handles NSE's four date styles");
const bhav = parseBhav(BHAV);
ok(bhav.length === 4 && !bhav.some((r) => r.series === "N1"), "bhavcopy keeps equity series (EQ/BE), drops bonds");
ok(bhav.find((r) => r.symbol === "T2TCO")?.deliveryPct === null, "'-' delivery parses as null, not 0");
ok(near(bhav.find((r) => r.symbol === "UPCO")?.deliveryPct, 70, 1e-9) && bhav[0].date === "2026-11-18", "delivery % and date parsed");
const sec = parseSecList(SECLIST);
ok(sec.get("UPCO")?.band === null && sec.get("DOWNCO")?.band === 10 && sec.get("GSMCO")?.gsm === "Stage I", "price band (No Band → null) and GSM stage parsed");
ok(JSON.stringify(parseBan(BAN)) === '["UPCO"]', "F&O ban list parsed");
ok(parseDeals(BULK, "bulk").length === 3 && parseDeals("Date,Symbol\nNO RECORDS,,", "block").length === 0, "bulk deals parsed; 'NO RECORDS' gives none");
ok(parseLots(LOTS).get("UPCO") === 500 && !parseLots(LOTS).has("Symbol"), "lot sizes parsed, header rows skipped");
const poi = parseParticipants(POI);
ok(poi.length === 2 && near(poi.find((p) => p.client === "FII")?.longPct, 0.3, 1e-9), "participant OI parsed (TOTAL dropped), FII 30% long");

/* -------------------------------------------------- zip -------------------------------------------------- */

{
  const content = Buffer.from("hello,nse\n1,2\n");
  const data = deflateRawSync(content);
  const name = Buffer.from("x.csv");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(name.length, 26);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(8, 10);
  cd.writeUInt32LE(data.length, 20);
  cd.writeUInt32LE(content.length, 24);
  cd.writeUInt16LE(name.length, 28);
  cd.writeUInt32LE(0, 42);
  const cdOffset = local.length + name.length + data.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt32LE(cdOffset, 16);
  const zip = Buffer.concat([local, name, data, cd, name, eocd]);
  ok(unzipFirst(zip).toString() === content.toString(), "unzipFirst inflates a deflated ZIP entry");
}

/* ------------------------------------------- options maths ------------------------------------------- */

const o = { spot: 100, strike: 100, years: 1, rate: 0.05, type: "CE" as const };
ok(near(bsPrice(o, 0.2), 10.4506, 1e-3) && near(bsPrice({ ...o, type: "PE" }, 0.2), 5.5735, 1e-3), "Black–Scholes matches textbook values (call 10.4506, put 5.5735)");
ok(near(impliedVol(o, 10.4506), 0.2, 1e-4), "implied volatility round-trips (20%)");
ok(impliedVol({ ...o, strike: 80 }, 10) === null, "price below intrinsic → no IV (null, not garbage)");
const g = greeks(o, 10.4506)!;
ok(near(g.delta, 0.6368, 1e-3) && near(g.gamma, 0.01876, 1e-4) && near(g.vega, 0.3752, 1e-3), "Greeks: delta 0.637, gamma 0.0188, vega 0.375");
ok(classifyBuildup(1, 5) === "long build-up" && classifyBuildup(-1, 5) === "short build-up" && classifyBuildup(1, -5) === "short covering" && classifyBuildup(-1, -5) === "long unwinding", "build-up: the four price × OI quadrants");
ok(classifyBuildup(0.05, 5) === null && classifyBuildup(1, 0.5) === null, "tiny price or OI changes are not classified");
ok(maxPain([{ strike: 90, callOi: 0, putOi: 100 }, { strike: 100, callOi: 50, putOi: 50 }, { strike: 110, callOi: 100, putOi: 0 }]) === 100, "max pain = strike with the least payout to option buyers");

const fno = buildFnoSummaries(parseFoBhav(FO).rows, "2026-11-18").get("UPCO")!;
ok(fno.buildup === "long build-up" && near(fno.futOiChangePct, (100_000 / 1_100_000) * 100, 0.01), "futures: OI summed over expiries (+9.1% on the prior 11 lakh), long build-up");
ok(fno.callOi === 850_000 && fno.putOi === 720_000 && near(fno.pcr, 720 / 850, 1e-6), "option chain OI totals and PCR");
ok(fno.resistance === 110 && fno.support === 100 && fno.atmStrike === 105, "OI walls: resistance 110 (max call OI), support 100 (max put OI), ATM 105");
ok(fno.atmIv != null && fno.atmIv > 0.05 && fno.atmIv < 1.5 && fno.lotSize === 500, `ATM IV computed (${((fno.atmIv ?? 0) * 100).toFixed(0)}%), lot size 500`);

/* ----------------------------------------- assemble + interpret ----------------------------------------- */

const history = new Map([["UPCO", { volumeAvg: 800_000, deliveryAvg: 40, days: 10 }], ["DOWNCO", { volumeAvg: 480_000, deliveryAvg: 40, days: 10 }]]);
const { market, stocks } = assembleDay({ bhav: BHAV, seclist: SECLIST, ban: BAN, bulk: BULK, lots: LOTS, participants: POI, fo: FO }, "2026-11-18", [], history);
const up = stocks.get("UPCO")!;
ok(up.inFno && up.fnoBan && up.band === null && near(up.volRatio, 2.5, 1e-9) && up.deals.length === 3, "UPCO: F&O, in ban, no band, 2.5× volume, 3 deals");
ok(stocks.get("T2TCO")!.bandHit === "upper", "T2TCO closed +5% on a 5% band → upper circuit hit");
ok(market.breadth.advances === 2 && market.breadth.declines === 1, "breadth counts the regular EQ series only (2 up, 1 down; trade-to-trade excluded)");
ok(market.fnoBan[0] === "UPCO" && market.gsm.length === 1 && market.counts.fnoUnderlyings === 1, "market lists: ban, GSM, F&O count");

const sig = interpretStock(up, { earningsDate: "2026-11-20", earningsDateEnd: null, exDividendDate: null, dividendDate: null }, "2026-11-19");
const by = (id: string) => sig.find((x) => x.id === id);
ok(by("delivery")?.effect === "bullish" && by("buildup")?.effect === "bullish" && by("volume")?.effect === "bullish", "UPCO: accumulation + long build-up + volume spike = bullish evidence");
ok(by("deals")?.effect === "bullish" && by("deals")!.value.includes("5.00 lakh"), "deals: HFT churn ignored, net 5 lakh bought by the fund");
ok(by("fno-ban")?.effect === "risk" && !by("fno-ban")!.blocks, "F&O ban is a warning, not an equity veto");
ok(by("results")?.blocks?.includes("intraday") === true, "results due next session → blocks intraday");
const swingEarn = interpretStock(up, { earningsDate: "2026-11-28", earningsDateEnd: null, exDividendDate: null, dividendDate: null }, "2026-11-19").find((x) => x.id === "results");
ok(swingEarn?.effect === "risk" && !swingEarn.blocks, "results in 9 days → swing risk warning, not a veto");
const gsmSig = interpretStock(stocks.get("GSMCO")!, null, "2026-11-19");
ok(gsmSig.find((x) => x.id === "gsm")?.blocks?.length === 3, "GSM blocks every horizon");
const t2t = interpretStock(stocks.get("T2TCO")!, null, "2026-11-19");
ok(t2t.some((x) => x.id === "t2t" && x.blocks?.includes("intraday")) && t2t.some((x) => x.id === "band-hit") && t2t.some((x) => x.id === "band" && x.effect === "risk"), "T2T series, circuit hit and 5% band all block intraday");
const down = interpretStock(stocks.get("DOWNCO")!, null, "2026-11-19");
ok(down.find((x) => x.id === "delivery")?.effect === "bearish", "DOWNCO: high delivery on a −5% day = distribution (bearish)");
const nd = netDirection(sig, ["delivery", "buildup", "deals"], { buildup: 2, delivery: 2, deals: 1.5 });
ok(nd.score === 1 && nd.used === 5.5, "netDirection: all bullish → +1 over the weights used");
const ms = interpretMarket(market);
ok(ms.find((x) => x.id === "breadth")?.effect === "bullish" && ms.find((x) => x.id === "fii")?.effect === "bearish", "market: breadth 2.0 bullish; FII 30% long hits the ≤ 30% bearish threshold");
ok(interpretStock(null, null, "2026-11-19").length === 0, "no data → no signals (nothing invented)");

/* -------------------------------------------- plan entry rules -------------------------------------------- */

ok(planEntry("long", 100, 98, 104, 101, 0.5).ok, "long: open a little above ref → enter");
ok(!planEntry("long", 100, 98, 104, 97.5, 0.5).ok, "long: gapped below the stop → skip");
ok(!planEntry("long", 100, 98, 104, 104.2, 0.5).ok, "long: gapped above the target → skip");
ok(!planEntry("long", 100, 98, 104, 102.1, 0.5).ok, "long: already 52% of the way to target → skip (no chasing)");
ok(planEntry("short", 100, 102, 96, 99.5, 0.5).ok && !planEntry("short", 100, 102, 96, 102.5, 0.5).ok, "short mirrors long");
ok(sizeFor(100, 98, 100_000, 1) === 500 && sizeFor(100, 99.9, 100_000, 1) === 1000 && sizeFor(100, 100, 1e5, 1) === 0, "size = risk ÷ stop distance, capped by capital; zero distance → 0");

/* ------------------------------------------------- SQL ------------------------------------------------- */

const trade = (over: Partial<PaperTrade>): PaperTrade => ({
  id: "x", tradeDay: "2026-11-19", symbol: "UPCO.NS", name: "Up", openedAt: "2026-11-19T04:05:00Z", trigger: "plan", planMadeOn: "2026-11-18", kind: "recommended", side: "long",
  decision: "WATCHLIST", validation: "APPROVED WITH CONDITIONS", score: 70, entry: 100, target: 104, stop: 98, qty: 10, riskReward: 2, reasons: [], votes: [], reportId: null,
  status: "target", exitPrice: 104, exitAt: null, grossPnl: 40, costs: 1, netPnl: 39, returnPct: 3.9, ...over,
});

(async () => {
  const pg = new PGlite();
  const db = { query: async <T,>(t: string, p: unknown[] = []) => (await pg.query(t, p as unknown[])).rows as T[] };
  setDbForTesting(db);
  for (const s of SCHEMA) await db.query(s);

  // exchange_stocks bulk insert via jsonb_to_recordset (the same statement the store uses)
  const rows = [...stocks.values()].map((s) => ({ symbol: s.symbol, close: s.close, volume: s.volume, delivery_pct: s.deliveryPct, data: s }));
  await db.query(
    `insert into exchange_stocks (trade_date, symbol, close, volume, delivery_pct, data)
     select $1, x.symbol, x.close, x.volume, x.delivery_pct, x.data
     from jsonb_to_recordset($2::jsonb) as x(symbol text, close double precision, volume double precision, delivery_pct double precision, data jsonb)
     on conflict (trade_date, symbol) do update set close = excluded.close, volume = excluded.volume, delivery_pct = excluded.delivery_pct, data = coalesce(excluded.data, exchange_stocks.data)`,
    ["2026-11-18", JSON.stringify(rows)],
  );
  const back = await db.query<{ data: StockDay | string; delivery_pct: number | null }>(`select data, delivery_pct from exchange_stocks where symbol = 'UPCO'`);
  const d0 = typeof back[0].data === "string" ? JSON.parse(back[0].data) : back[0].data;
  ok(back.length === 1 && d0.fno.buildup === "long build-up" && Number(back[0].delivery_pct) === 70, "exchange_stocks: bulk insert round-trips the full record");
  const t2tRow = await db.query<{ delivery_pct: number | null }>(`select delivery_pct from exchange_stocks where symbol = 'T2TCO'`);
  ok(t2tRow[0].delivery_pct === null, "null delivery stays null in SQL");

  // plans: save → claim once → execute → expire older
  const plan = (madeOn: string): SessionPlan => ({ madeOn, createdAt: "", exchangeDate: madeOn, status: "pending", marketNote: "", screened: 10, items: [], skipped: [], errors: [], execution: null });
  ok(await savePlan(plan("2026-11-16")), "save plan (16th)");
  ok(await savePlan(plan("2026-11-18")), "save plan (18th)");
  ok(await savePlan({ ...plan("2026-11-18"), screened: 99 }), "rebuild a pending plan replaces it");
  const claimed = await claimPendingPlan("2026-11-19", "2026-11-15");
  ok(claimed?.madeOn === "2026-11-18" && claimed.status === "executing" && claimed.screened === 99, "claim picks the newest pending plan before today");
  ok((await claimPendingPlan("2026-11-19", "2026-11-15")) === null, "a second claim gets nothing (executes once)");
  ok((await getPlan("2026-11-16"))?.status === "expired", "older pending plan is expired");
  ok(!(await savePlan(plan("2026-11-18"))), "an executing/executed plan is never overwritten by a rebuild");
  await finishPlan({ ...claimed!, status: "executed", execution: { day: "2026-11-19", at: "", rows: [{ symbol: "UPCO.NS", entered: true, reason: "Entered", price: 100, tradeId: "x" }] } });
  ok((await planExecutedOn("2026-11-19"))?.madeOn === "2026-11-18", "plan executed on the 19th is found for the report");
  await savePlan(plan("2026-11-10"));
  ok((await claimPendingPlan("2026-11-19", "2026-11-15")) === null && (await getPlan("2026-11-10"))?.status === "expired", "a pending plan older than the expiry window is expired, not executed");

  // report
  const trades = [trade({}), trade({ symbol: "B.NS", status: "stop", exitPrice: 98, netPnl: -21 }), trade({ symbol: "C.NS", trigger: "auto", planMadeOn: null, netPnl: 5, status: "square-off" }), trade({ symbol: "D.NS", kind: "shadow", netPnl: -10, status: "stop" })];
  const planG = group(trades.filter((t) => t.kind === "recommended" && t.trigger === "plan"));
  ok(planG.trades === 2 && planG.wins === 1 && planG.netPnl === 18 && planG.targetHits === 1 && planG.stopHits === 1, "report group: plan 2 trades, 1 right, +₹18");
  const head = headlineFor({ day: "2026-11-19", planMadeOn: "2026-11-18", planIdeas: 3, planEntered: 2, planSkipped: [{ symbol: "E", reason: "gap" }], plan: planG, live: group([trades[2]]), shadow: group([trades[3]]), recommended: group(trades.slice(0, 3)), rows: [] });
  ok(head.includes("3 ideas, 2 entered, 1 skipped") && head.includes("rejecting them was right"), `headline: ${head}`);
  await saveDailyReport({ day: "2026-11-19", createdAt: "", headline: head, planMadeOn: "2026-11-18", planIdeas: 3, planEntered: 2, planSkipped: [], plan: planG, live: group([]), shadow: group([]), recommended: planG, rows: [], emailed: null });
  ok((await listDailyReports())[0]?.day === "2026-11-19", "daily report saved and listed");

  console.log(fail ? `\n${fail} FAILED` : "\nAll exchange-data checks passed");
  process.exit(fail ? 1 : 0);
})();
