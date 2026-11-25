import "server-only";
import { mapLimit } from "../agents/scan";
import { getDb } from "../db/client";
import { computeIndicators } from "../indicators";
import { levelContext } from "../levels";
import type { Candle } from "../types";
import { fetchChart } from "../yahoo";
import { aggregate, chartVerdict, combinedScore, parseDisclosureXml, type ChartVerdict, type InsiderStock, type InsiderTxn } from "./core";

/**
 * Nightly insider-trading job:
 *   1. list the last week's SEBI PIT disclosures from NSE (one request; the user chose automatic
 *      fetching from NSE's website — it identifies itself honestly and makes one call a night),
 *   2. download each disclosure's XBRL file from NSE's public archive (once — cached by appId),
 *   3. aggregate promoter / director / KMP open-market trades per stock,
 *   4. check each buying stock's daily chart (structure, levels, patterns),
 *   5. save the day's screen so its picks can be scored against the next sessions.
 */

const NSE_WEB = process.env.NSE_WEB_BASE ?? "https://www.nseindia.com";
const UA = "ApexDesk/1.0 (end-of-day research; public disclosures)";
export const INSIDER = { lookbackDays: 7, maxCharts: 25, maxNewFilings: 400 } as const;

type ListRow = { appId: string; symbol: string; companyName: string; broadcastDateTime: string; xmlFileName: string | null; regulation: string };

const ddmmyyyy = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${d.getUTCFullYear()}`;
const istNow = () => new Date(Date.now() + 5.5 * 3600_000);
export const istToday = () => istNow().toISOString().slice(0, 10);

const MON: Record<string, string> = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
/** "25-Nov-2026 18:03:11" (IST) → ISO. */
export function parseNseTime(s: string): string {
  const m = /^(\d{2})-([A-Za-z]{3})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/.exec(s);
  if (!m) return new Date().toISOString();
  return new Date(`${m[3]}-${MON[m[2]] ?? "01"}-${m[1]}T${m[4]}:${m[5]}:${m[6]}+05:30`).toISOString();
}

async function listDisclosures(days: number): Promise<ListRow[]> {
  const to = istNow();
  const from = new Date(to.getTime() - days * 86400_000);
  const url = `${NSE_WEB}/api/corporates-pit-gg?index=equities&from_date=${ddmmyyyy(from)}&to_date=${ddmmyyyy(to)}`;
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`NSE insider list: HTTP ${res.status}`);
  const text = await res.text();
  if (/^\s*</.test(text)) throw new Error("NSE insider list returned a web page instead of data (blocked or changed).");
  const json = JSON.parse(text) as { data?: ListRow[] };
  return (json.data ?? []).filter((r) => r.regulation?.includes("7 (2)") && r.xmlFileName);
}

async function fetchFiling(r: ListRow): Promise<InsiderTxn[]> {
  const res = await fetch(r.xmlFileName!, { headers: { "User-Agent": UA }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseDisclosureXml(await res.text(), { appId: r.appId, symbol: r.symbol, company: r.companyName, disclosedAt: parseNseTime(r.broadcastDateTime) });
}

/* --------------------------------------------- storage --------------------------------------------- */

const memory = { filings: new Map<string, { disclosedAt: string; txns: InsiderTxn[] }>(), screens: new Map<string, InsiderScreen>() };

async function knownIds(ids: string[]): Promise<Set<string>> {
  const db = await getDb();
  if (!db) return new Set(ids.filter((i) => memory.filings.has(i)));
  const rows = await db.query<{ app_id: string }>(`select app_id from insider_filings where app_id = any($1::text[])`, [ids]);
  return new Set(rows.map((r) => r.app_id));
}

async function saveFiling(appId: string, symbol: string, disclosedAt: string, txns: InsiderTxn[]) {
  const db = await getDb();
  if (!db) {
    memory.filings.set(appId, { disclosedAt, txns });
    return;
  }
  await db.query(`insert into insider_filings (app_id, symbol, disclosed_at, txns) values ($1, $2, $3, $4::jsonb) on conflict (app_id) do nothing`, [appId, symbol, disclosedAt, JSON.stringify(txns)]);
}

/** Every stored transaction disclosed on or after `sinceIso`. */
export async function txnsSince(sinceIso: string): Promise<InsiderTxn[]> {
  const db = await getDb();
  if (!db) return [...memory.filings.values()].filter((f) => f.disclosedAt >= sinceIso).flatMap((f) => f.txns);
  const rows = await db.query<{ txns: InsiderTxn[] | string }>(`select txns from insider_filings where disclosed_at >= $1`, [sinceIso]);
  return rows.flatMap((r) => (typeof r.txns === "string" ? (JSON.parse(r.txns) as InsiderTxn[]) : r.txns));
}

/* --------------------------------------------- screen --------------------------------------------- */

export type InsiderPick = InsiderStock & {
  chart: { verdict: ChartVerdict; score: number; reasons: string[]; price: number | null; support: number | null; resistance: number | null; structure: string | null };
  rank: number;
};

export type InsiderScreen = {
  day: string;
  createdAt: string;
  filings: number;
  fetchedNow: number;
  errors: string[];
  buying: InsiderPick[];
  selling: InsiderStock[];
  /** Filled in later: how the "ready" picks did after the screen (see scoreScreens). */
  outcome?: { scoredAt: string; picks: Array<{ symbol: string; entry: number; next: number | null; after5: number | null }> } | null;
};

async function chartCheck(symbol: string): Promise<InsiderPick["chart"]> {
  const empty = { verdict: "no-data" as ChartVerdict, score: 0, reasons: ["No daily chart data"], price: null, support: null, resistance: null, structure: null };
  let candles: Candle[];
  try {
    candles = (await fetchChart(`${symbol}.NS`, "1y", "1d")).candles;
    if (candles.length < 60) candles = (await fetchChart(`${symbol}.BO`, "1y", "1d")).candles;
  } catch {
    return empty;
  }
  const ctx = levelContext(candles);
  if (!ctx) return empty;
  const ind = computeIndicators(candles);
  const sma200 = ind.sma200;
  const closes = candles.map((c) => c.close);
  const sma200Prev = closes.length >= 221 ? closes.slice(-221, -21).reduce((a, b) => a + b, 0) / 200 : null;
  const belowFalling200 = sma200 != null && sma200Prev != null && ctx.price < sma200 && sma200 < sma200Prev;
  const v = chartVerdict({ structure: ctx.structure, toResistanceAtr: ctx.toResistanceAtr, toSupportAtr: ctx.toSupportAtr, belowFalling200, bullishPattern: ctx.pattern?.side === "buy" });
  return { ...v, price: ctx.price, support: ctx.support?.high ?? null, resistance: ctx.resistance?.low ?? null, structure: ctx.structure };
}

/** Fetch new disclosures, rebuild the week's insider screen and save it for today. */
export async function runInsiderScreen(): Promise<InsiderScreen> {
  const errors: string[] = [];
  const day = istToday();
  let rows: ListRow[] = [];
  try {
    rows = await listDisclosures(INSIDER.lookbackDays + 1);
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }
  const known = rows.length ? await knownIds(rows.map((r) => r.appId)) : new Set<string>();
  const todo = rows.filter((r) => !known.has(r.appId)).slice(0, INSIDER.maxNewFilings);
  let fetchedNow = 0;
  await mapLimit(todo, 5, async (r) => {
    try {
      await saveFiling(r.appId, r.symbol, parseNseTime(r.broadcastDateTime), await fetchFiling(r));
      fetchedNow++;
    } catch (e) {
      if (errors.length < 8) errors.push(`${r.symbol}: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  const since = new Date(Date.now() - INSIDER.lookbackDays * 86400_000).toISOString();
  const stocks = aggregate(await txnsSince(since));
  const buyingRaw = stocks.filter((s) => s.direction === "buying" && s.insiderScore > 0).slice(0, INSIDER.maxCharts);
  const charts = await mapLimit(buyingRaw, 4, (s) => chartCheck(s.symbol));
  const buying: InsiderPick[] = buyingRaw
    .map((s, i) => ({ ...s, chart: charts[i], rank: charts[i].verdict === "avoid" ? Math.round(combinedScore(s.insiderScore, charts[i].score) / 2) : combinedScore(s.insiderScore, charts[i].score) }))
    .sort((a, b) => b.rank - a.rank);
  const screen: InsiderScreen = { day, createdAt: new Date().toISOString(), filings: rows.length, fetchedNow, errors, buying, selling: stocks.filter((s) => s.direction === "selling" && s.sellValue >= 1e6).slice(0, 15) };
  await saveScreen(screen);
  return screen;
}

async function saveScreen(s: InsiderScreen) {
  const db = await getDb();
  if (!db) {
    memory.screens.set(s.day, s);
    return;
  }
  // Keep an earlier outcome if the screen for the day is rebuilt.
  await db.query(
    `insert into insider_screens (day, data) values ($1, $2::jsonb)
     on conflict (day) do update set data = excluded.data || jsonb_build_object('outcome', insider_screens.data->'outcome'), created_at = now()`,
    [s.day, JSON.stringify(s)],
  );
}

export async function listScreens(limit = 60): Promise<InsiderScreen[]> {
  const db = await getDb();
  if (!db) return [...memory.screens.values()].sort((a, b) => b.day.localeCompare(a.day)).slice(0, limit);
  const rows = await db.query<{ data: InsiderScreen | string }>(`select data from insider_screens order by day desc limit $1`, [limit]);
  return rows.map((r) => (typeof r.data === "string" ? (JSON.parse(r.data) as InsiderScreen) : r.data));
}

export async function latestScreen(): Promise<InsiderScreen | null> {
  return (await listScreens(1))[0] ?? null;
}

/* --------------------------------------------- track record --------------------------------------------- */

/**
 * Score past screens: for each "Setup ready" pick, the return from the screen-day close to the next
 * session's close and to the close 5 sessions later. Uses daily candles (one request per symbol).
 */
export async function scoreScreens(): Promise<{ scored: number }> {
  const screens = (await listScreens(60)).filter((s) => !s.outcome || s.outcome.picks.some((p) => p.after5 == null));
  let scored = 0;
  const chartCache = new Map<string, Candle[]>();
  const candlesOf = async (sym: string) => {
    if (!chartCache.has(sym)) chartCache.set(sym, await fetchChart(`${sym}.NS`, "6mo", "1d").then((r) => r.candles).catch(() => []));
    return chartCache.get(sym)!;
  };
  const istDayOf = (t: number) => new Date((t + 19800) * 1000).toISOString().slice(0, 10);
  for (const s of screens) {
    if (s.day >= istToday()) continue;
    const ready = s.buying.filter((p) => p.chart.verdict === "ready").slice(0, 10);
    const picks = [];
    for (const p of ready) {
      const c = await candlesOf(p.symbol);
      const i = c.findIndex((x) => istDayOf(x.time) === s.day);
      const base = i >= 0 ? c[i] : c.filter((x) => istDayOf(x.time) < s.day).at(-1);
      const bi = base ? c.indexOf(base) : -1;
      if (bi < 0) continue;
      const entry = c[bi].close;
      const next = c[bi + 1] ? (c[bi + 1].close / entry - 1) * 100 : null;
      const after5 = c[bi + 5] ? (c[bi + 5].close / entry - 1) * 100 : null;
      picks.push({ symbol: p.symbol, entry, next, after5 });
    }
    const outcome = { scoredAt: new Date().toISOString(), picks };
    const db = await getDb();
    if (db) await db.query(`update insider_screens set data = jsonb_set(data, '{outcome}', $2::jsonb) where day = $1`, [s.day, JSON.stringify(outcome)]);
    else memory.screens.set(s.day, { ...s, outcome });
    scored++;
  }
  return { scored };
}

export type InsiderTrack = { screens: number; picks: number; nextAvg: number | null; nextHit: number | null; after5Avg: number | null; after5Hit: number | null };

/** Aggregate track record of the strategy's "Setup ready" picks. */
export function trackRecord(screens: InsiderScreen[]): InsiderTrack {
  const all = screens.flatMap((s) => s.outcome?.picks ?? []);
  const n = all.filter((p) => p.next != null).map((p) => p.next!);
  const f = all.filter((p) => p.after5 != null).map((p) => p.after5!);
  const avg = (x: number[]) => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : null);
  const hit = (x: number[]) => (x.length ? x.filter((v) => v > 0).length / x.length : null);
  return { screens: screens.filter((s) => s.outcome).length, picks: all.length, nextAvg: avg(n), nextHit: hit(n), after5Avg: avg(f), after5Hit: hit(f) };
}

/** Insider summary for one stock (agents): last week's qualifying trades, or null. */
export async function insiderFor(symbol: string): Promise<InsiderStock | null> {
  const base = symbol.replace(/\.(NS|BO)$/, "").toUpperCase();
  const since = new Date(Date.now() - INSIDER.lookbackDays * 86400_000).toISOString();
  const db = await getDb();
  let txns: InsiderTxn[];
  if (db) {
    const rows = await db.query<{ txns: InsiderTxn[] | string }>(`select txns from insider_filings where symbol = $1 and disclosed_at >= $2`, [base, since]).catch(() => []);
    txns = rows.flatMap((r) => (typeof r.txns === "string" ? (JSON.parse(r.txns) as InsiderTxn[]) : r.txns));
  } else txns = [...memory.filings.values()].filter((f) => f.disclosedAt >= since).flatMap((f) => f.txns).filter((t) => t.symbol === base);
  return aggregate(txns)[0] ?? null;
}
