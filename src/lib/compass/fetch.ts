import "server-only";
import { getDb } from "../db/client";
import { getMarketDay } from "../exchange/store";
import { fetchChart } from "../yahoo";
import { accuracy, buildCompass, grade, type Compass, type CompassInputs, type CompassOutcome } from "./core";

/**
 * Inputs for the Market Compass. Sources (all public, the client identifies itself honestly):
 *  - Yahoo Finance: Dow Jones, Nasdaq, S&P 500, US futures, Nikkei, Hang Seng, NIFTY, India VIX
 *  - NSE International Exchange ticker: GIFT Nifty futures (the old SGX Nifty)
 *  - NSE pre-open session (09:00–09:08): NIFTY 50 advances / declines and indicative change
 *  - NSE end-of-day files (already stored): previous session's breadth
 */

const UA = "ApexDesk/1.0 (market research; public market data)";
const NSE_WEB = process.env.NSE_WEB_BASE ?? "https://www.nseindia.com";
const NSE_IX = process.env.NSE_IX_BASE ?? "https://www.nseix.com";

export const GLOBAL_MARKETS: Array<{ symbol: string; label: string; group: "India" | "US" | "Asia" | "Europe" | "Macro" }> = [
  { symbol: "^NSEI", label: "NIFTY 50", group: "India" },
  { symbol: "^NSEBANK", label: "BANK NIFTY", group: "India" },
  { symbol: "^BSESN", label: "SENSEX", group: "India" },
  { symbol: "^INDIAVIX", label: "INDIA VIX", group: "India" },
  { symbol: "^DJI", label: "Dow Jones", group: "US" },
  { symbol: "^IXIC", label: "Nasdaq", group: "US" },
  { symbol: "^GSPC", label: "S&P 500", group: "US" },
  { symbol: "YM=F", label: "Dow futures", group: "US" },
  { symbol: "NQ=F", label: "Nasdaq futures", group: "US" },
  { symbol: "^N225", label: "Nikkei 225", group: "Asia" },
  { symbol: "^HSI", label: "Hang Seng", group: "Asia" },
  { symbol: "^FTSE", label: "FTSE 100", group: "Europe" },
  { symbol: "^GDAXI", label: "DAX", group: "Europe" },
  { symbol: "BZ=F", label: "Brent crude", group: "Macro" },
  { symbol: "INR=X", label: "USD / INR", group: "Macro" },
  { symbol: "GC=F", label: "Gold", group: "Macro" },
];

export type MarketTile = { symbol: string; label: string; group: string; price: number | null; changePct: number | null; time: string | null };

async function quote(symbol: string): Promise<{ price: number; changePct: number; time: string } | null> {
  try {
    const { quote: q, candles } = await fetchChart(symbol, "5d", "1d");
    const t = candles.at(-1)?.time;
    return { price: q.price, changePct: q.changePercent, time: t ? new Date(t * 1000).toISOString() : new Date().toISOString() };
  } catch {
    return null;
  }
}

async function json(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (/^\s*</.test(text)) throw new Error("web page instead of data");
  return JSON.parse(text);
}

/** GIFT Nifty: the most-traded NIFTY index future on the NSE IX ticker. */
export async function giftNifty(): Promise<CompassInputs["gift"]> {
  try {
    const j = (await json(`${NSE_IX}/api/market-rate?type=derivatives`)) as { data?: Array<Record<string, unknown>> };
    const futs = (j.data ?? []).filter((r) => r.SYMBOL === "NIFTY" && r.INSTRUMENTTYPE === "FUTIDX");
    const top = futs.sort((a, b) => Number(b.CONTRACTSTRADED ?? 0) - Number(a.CONTRACTSTRADED ?? 0))[0];
    if (!top) return null;
    const price = Number(String(top.LASTPRICE).replace(/,/g, ""));
    if (!(price > 0)) return null;
    const ch = Number(String(top.PERCHANGE ?? "").replace(/,/g, ""));
    const MON: Record<string, string> = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
    const m = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(String(top.EXPIRYDATE ?? ""));
    const expiry = m ? `${m[3]}-${MON[m[2]] ?? "01"}-${m[1]}` : null;
    return { price, changePct: Number.isFinite(ch) ? ch : null, at: typeof top.TIMESTMP === "string" ? top.TIMESTMP : null, expiry };
  } catch {
    return null;
  }
}

/** NSE pre-open (09:00–09:08) for NIFTY 50. Returns null outside the session or if unavailable. */
export async function preOpen(): Promise<CompassInputs["preOpen"]> {
  try {
    const j = (await json(`${NSE_WEB}/api/market-data-pre-open?key=NIFTY`)) as {
      advances?: number;
      declines?: number;
      data?: Array<{ metadata?: { symbol?: string; pChange?: number | string } }>;
      niftyPreopenStatus?: { pChange?: number | string };
    };
    const rows = (j.data ?? []).map((d) => d.metadata).filter((m): m is NonNullable<typeof m> => Boolean(m));
    if (!rows.length && j.advances == null) return null;
    const ch = (v: unknown) => Number(String(v ?? "").replace(/,/g, ""));
    const advances = typeof j.advances === "number" ? j.advances : rows.filter((m) => ch(m.pChange) > 0).length;
    const declines = typeof j.declines === "number" ? j.declines : rows.filter((m) => ch(m.pChange) < 0).length;
    const idx = j.niftyPreopenStatus?.pChange != null ? ch(j.niftyPreopenStatus.pChange) : null;
    return { advances, declines, indexChangePct: idx != null && Number.isFinite(idx) ? idx : null };
  } catch {
    return null;
  }
}

let cache: { at: number; compass: Compass; tiles: MarketTile[] } | null = null;

/** The compass right now (cached for 2 minutes) and the global market tiles. */
export async function currentCompass(force = false): Promise<{ compass: Compass; tiles: MarketTile[] }> {
  if (!force && cache && Date.now() - cache.at < 120_000) return cache;
  const [quotes, gift, pre, market] = await Promise.all([
    Promise.all(GLOBAL_MARKETS.map((m) => quote(m.symbol))),
    giftNifty(),
    preOpen(),
    getMarketDay().catch(() => null),
  ]);
  const q = (sym: string) => quotes[GLOBAL_MARKETS.findIndex((m) => m.symbol === sym)] ?? null;
  const nifty = q("^NSEI");
  const istNow = new Date(Date.now() + 5.5 * 3600_000);
  const minutes = istNow.getUTCHours() * 60 + istNow.getUTCMinutes();
  // Before 15:30 IST on a trading day NIFTY's "price" is live; the gap reference is the last close.
  const niftyClose = nifty ? (minutes >= 9 * 60 + 15 && minutes < 15 * 60 + 30 ? nifty.price / (1 + nifty.changePct / 100) : nifty.price) : null;
  const vix = q("^INDIAVIX");
  const inputs: CompassInputs = {
    asOf: new Date().toISOString(),
    us: { dow: q("^DJI")?.changePct ?? null, nasdaq: q("^IXIC")?.changePct ?? null, sp: q("^GSPC")?.changePct ?? null, closedAt: q("^DJI")?.time ?? null },
    usFutures: { dow: q("YM=F")?.changePct ?? null, nasdaq: q("NQ=F")?.changePct ?? null },
    asia: { nikkei: q("^N225")?.changePct ?? null, hangSeng: q("^HSI")?.changePct ?? null },
    gift,
    niftyClose,
    preOpen: pre,
    prevBreadth: market?.breadth ? { advances: market.breadth.advances, declines: market.breadth.declines } : null,
    vix: vix ? { level: vix.price, changePct: vix.changePct } : null,
  };
  const compass = buildCompass(inputs);
  const tiles: MarketTile[] = GLOBAL_MARKETS.map((m, i) => ({ symbol: m.symbol, label: m.label, group: m.group, price: quotes[i]?.price ?? null, changePct: quotes[i]?.changePct ?? null, time: quotes[i]?.time ?? null }));
  if (gift) tiles.splice(4, 0, { symbol: "GIFTNIFTY", label: "GIFT Nifty", group: "India", price: gift.price, changePct: gift.changePct, time: gift.at });
  cache = { at: Date.now(), compass, tiles };
  return cache;
}

/* ------------------------------------------ daily record ------------------------------------------ */

const istDay = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const memory = new Map<string, { compass: Compass; outcome: CompassOutcome | null }>();

/** Save today's compass (the 08:30 reading, upgraded by the pre-open reading when it arrives). */
export async function recordCompass(compass: Compass): Promise<void> {
  const day = istDay();
  const db = await getDb();
  if (!db) {
    const prev = memory.get(day);
    if (!prev || compass.checks.some((c) => c.id === "pre-open" && c.signal != null)) memory.set(day, { compass, outcome: prev?.outcome ?? null });
    return;
  }
  // Keep the first record of the day unless the new one includes the pre-open session.
  const hasPreOpen = compass.checks.some((c) => c.id === "pre-open" && c.signal != null);
  await db.query(
    `insert into market_compass (day, data) values ($1, $2::jsonb)
     on conflict (day) do update set data = excluded.data where $3::boolean and market_compass.outcome is null`,
    [day, JSON.stringify(compass), hasPreOpen],
  );
}

/** Grade past compass readings against NIFTY's actual open and close. */
export async function gradeCompass(): Promise<{ graded: number }> {
  const { candles } = await fetchChart("^NSEI", "3mo", "1d");
  const dayOf = (t: number) => new Date((t + 19800) * 1000).toISOString().slice(0, 10);
  const db = await getDb();
  const pending: Array<{ day: string; compass: Compass }> = db
    ? (await db.query<{ day: string; data: Compass | string }>(`select day, data from market_compass where outcome is null and day < $1 order by day`, [istDay()])).map((r) => ({ day: r.day, compass: typeof r.data === "string" ? (JSON.parse(r.data) as Compass) : r.data }))
    : [...memory.entries()].filter(([d, v]) => !v.outcome && d < istDay()).map(([day, v]) => ({ day, compass: v.compass }));
  let graded = 0;
  for (const p of pending) {
    const i = candles.findIndex((c) => dayOf(c.time) === p.day);
    if (i < 1 || p.compass.score == null) continue;
    const o = grade(p.day, p.compass.score, candles[i - 1].close, candles[i].open, candles[i].close);
    if (db) await db.query(`update market_compass set outcome = $2::jsonb where day = $1`, [p.day, JSON.stringify(o)]);
    else memory.set(p.day, { compass: p.compass, outcome: o });
    graded++;
  }
  return { graded };
}

export async function compassHistory(limit = 60): Promise<{ outcomes: CompassOutcome[]; accuracy: ReturnType<typeof accuracy> }> {
  const db = await getDb();
  const outcomes = db
    ? (await db.query<{ outcome: CompassOutcome | string }>(`select outcome from market_compass where outcome is not null order by day desc limit $1`, [limit])).map((r) => (typeof r.outcome === "string" ? (JSON.parse(r.outcome) as CompassOutcome) : r.outcome))
    : [...memory.values()].map((v) => v.outcome).filter((o): o is CompassOutcome => o != null);
  return { outcomes, accuracy: accuracy(outcomes) };
}
