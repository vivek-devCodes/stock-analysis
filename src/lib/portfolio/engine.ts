import "server-only";
import { mapLimit } from "../agents/scan";
import { getDb } from "../db/client";
import { getFundamentals } from "../fundamentals";
import { getLiveQuotes } from "../live";
import { istDate } from "../paper/rules";
import { fetchChart } from "../yahoo";
import { momentumOf, PORTFOLIO, rebalance, selectBasket, valueOf, type Candidate, type Rebalance } from "./core";

/**
 * Paper portfolio engine. Runs nightly: on the first trading session of a month (or when forced)
 * it re-selects the basket and rebalances at today's closing prices; every night it records the
 * portfolio value next to NIFTY 50 so the two can be compared.
 */

const FINANCIAL = new Set(["Banking", "Finance"]);
const parse = <T,>(v: T | string): T => (typeof v === "string" ? (JSON.parse(v) as T) : v);
const memory: { rebalances: Rebalance[]; nav: Array<{ day: string; nav: number; nifty: number | null }> } = { rebalances: [], nav: [] };

async function latestRebalance(): Promise<Rebalance | null> {
  const db = await getDb();
  if (!db) return memory.rebalances.at(-1) ?? null;
  const rows = await db.query<{ data: Rebalance | string }>(`select data from portfolio_rebalances order by day desc limit 1`);
  return rows[0] ? parse(rows[0].data) : null;
}

async function saveRebalance(r: Rebalance) {
  const db = await getDb();
  if (!db) {
    memory.rebalances = [...memory.rebalances.filter((x) => x.day !== r.day), r];
    return;
  }
  await db.query(`insert into portfolio_rebalances (day, data) values ($1, $2::jsonb) on conflict (day) do update set data = excluded.data, created_at = now()`, [r.day, JSON.stringify(r)]);
}

async function saveNav(day: string, nav: number, nifty: number | null) {
  const db = await getDb();
  if (!db) {
    memory.nav = [...memory.nav.filter((x) => x.day !== day), { day, nav, nifty }];
    return;
  }
  await db.query(`insert into portfolio_nav (day, nav, nifty) values ($1, $2, $3) on conflict (day) do update set nav = excluded.nav, nifty = excluded.nifty`, [day, nav, nifty]);
}

async function navHistory(): Promise<Array<{ day: string; nav: number; nifty: number | null }>> {
  const db = await getDb();
  if (!db) return [...memory.nav].sort((a, b) => a.day.localeCompare(b.day));
  const rows = await db.query<{ day: string; nav: number; nifty: number | null }>(`select day, nav, nifty from portfolio_nav order by day`);
  return rows.map((r) => ({ day: r.day, nav: Number(r.nav), nifty: r.nifty != null ? Number(r.nifty) : null }));
}

async function listRebalances(limit = 24): Promise<Rebalance[]> {
  const db = await getDb();
  if (!db) return [...memory.rebalances].reverse().slice(0, limit);
  const rows = await db.query<{ data: Rebalance | string }>(`select data from portfolio_rebalances order by day desc limit $1`, [limit]);
  return rows.map((r) => parse(r.data));
}

async function prices(symbols: string[]): Promise<Map<string, number>> {
  const quotes = symbols.length ? await getLiveQuotes(symbols).catch(() => []) : [];
  return new Map(quotes.filter((q) => q.price > 0).map((q) => [q.symbol, q.price]));
}

async function niftyClose(): Promise<number | null> {
  const q = (await getLiveQuotes(["^NSEI"]).catch(() => []))[0];
  return q?.price ?? null;
}

/** Screens the fundamentals universe for momentum + quality. */
async function candidates(): Promise<Candidate[]> {
  const funda = await getFundamentals();
  const rows = await mapLimit(funda.stocks, 6, async (f): Promise<Candidate | null> => {
    const chart = await fetchChart(f.symbol, "1y", "1d").catch(() => null);
    if (!chart?.candles.length) return null;
    const closes = chart.candles.map((c) => c.close);
    const m = momentumOf(closes);
    return {
      symbol: f.symbol,
      name: f.name,
      sector: f.sector,
      price: closes.at(-1)!,
      ...m,
      quality: f.scores.quality,
      roe: f.roe,
      debtToEquity: f.debtToEquity,
      financial: FINANCIAL.has(f.sector),
    };
  });
  return rows.filter((r): r is Candidate => r != null);
}

export async function runPortfolio(force = false): Promise<{ action: "rebalanced" | "marked" | "skipped"; day: string; nav: number | null; detail: string }> {
  const day = istDate(Math.floor(Date.now() / 1000));
  const last = await latestRebalance();
  const due = force || !last || last.day.slice(0, 7) !== day.slice(0, 7);

  if (due) {
    const cands = await candidates();
    if (cands.length < PORTFOLIO.size) return { action: "skipped", day, nav: null, detail: `Only ${cands.length} stocks had data — rebalance postponed.` };
    const { picks, eligible, rejected } = selectBasket(cands);
    const px = await prices([...new Set([...picks.map((p) => p.symbol), ...(last?.holdings.map((h) => h.symbol) ?? [])])]);
    for (const c of cands) if (!px.has(c.symbol)) px.set(c.symbol, c.price);
    const r = rebalance({ day, prev: last ? { holdings: last.holdings, cash: last.cash } : null, picks, prices: px });
    const record: Rebalance = { ...r, createdAt: new Date().toISOString(), screened: cands.length, eligible, rejected: rejected.slice(0, 60) };
    await saveRebalance(record);
    await saveNav(day, record.navAfter, await niftyClose());
    return { action: "rebalanced", day, nav: record.navAfter, detail: `${record.holdings.length} stocks; in: ${record.entered.join(", ") || "—"}; out: ${record.exited.join(", ") || "—"}; costs ₹${Math.round(record.costs)}` };
  }

  const px = await prices(last!.holdings.map((h) => h.symbol));
  const nav = valueOf(last!.holdings, last!.cash, px);
  await saveNav(day, nav, await niftyClose());
  return { action: "marked", day, nav, detail: `Next rebalance on the first session of ${nextMonth(day)}.` };
}

const nextMonth = (day: string) => {
  const [y, m] = day.split("-").map(Number);
  return new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
};

export type PortfolioView = Awaited<ReturnType<typeof getPortfolioView>>;

export async function getPortfolioView() {
  const [last, history, rebalances] = await Promise.all([latestRebalance(), navHistory(), listRebalances()]);
  const day = istDate(Math.floor(Date.now() / 1000));
  if (!last) return { started: false as const, capital: PORTFOLIO.capital, rules: PORTFOLIO, history, rebalances: [] as Rebalance[] };
  const px = await prices(last.holdings.map((h) => h.symbol));
  const nifty = await niftyClose();
  const nav = valueOf(last.holdings, last.cash, px);
  const first = history[0];
  const niftyStart = first?.nifty ?? null;
  return {
    started: true as const,
    capital: PORTFOLIO.capital,
    rules: PORTFOLIO,
    asOf: day,
    nav,
    cash: last.cash,
    returnPct: ((nav - PORTFOLIO.capital) / PORTFOLIO.capital) * 100,
    niftyReturnPct: niftyStart && nifty ? ((nifty - niftyStart) / niftyStart) * 100 : null,
    since: first?.day ?? last.day,
    nextRebalance: nextMonth(last.day),
    holdings: last.holdings.map((h) => {
      const price = px.get(h.symbol) ?? null;
      return { ...h, price, value: price != null ? price * h.qty : null, weightPct: price != null && nav > 0 ? ((price * h.qty) / nav) * 100 : null, pnlPct: price != null ? ((price - h.entryPrice) / h.entryPrice) * 100 : null };
    }),
    history,
    rebalances,
  };
}
