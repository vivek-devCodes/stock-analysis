import "server-only";
import { getDb } from "../db/client";
import { DATASET, DATASETS } from "./catalog";
import { assembleDay, type History } from "./build";
import { getCorporateEvents } from "./events";
import { download, istToday, latestPublishedDate, previousWeekdays } from "./fetch";
import { interpretStock } from "./interpret";
import { parseBhav } from "./parse";
import type { DatasetId, MarketDay, SourceStatus, StockDay, StockExchangeView } from "./types";

/**
 * Exchange-data store. The nightly job (and the first request of a new day) downloads the latest
 * published files, builds the day and saves it to Postgres; everything else reads from the
 * database or this process's cache. Without DATABASE_URL the day lives in memory only (no
 * delivery/volume history, so no averages).
 */

const HISTORY_SESSIONS = 10;
const KEEP_FULL_DAYS = 10;
const KEEP_DAYS = 40;
const CACHE_MS = 30 * 60_000;
const CHECK_MS = 20 * 60_000;
/** NSE publishes the session's files over a few hours; a day built before all of them arrived is rebuilt. */
const REBUILD_INCOMPLETE_MS = 20 * 60_000;
const LATE_FILES: DatasetId[] = ["fo", "participants", "indices", "wk52", "volt", "bse"];

/** Files still missing for this day (F&O bhavcopy, participant OI… are often published later in the evening). */
export const missingFiles = (m: MarketDay) => m.sources.filter((s) => LATE_FILES.includes(s.id) && !s.ok).map((s) => s.id);
const stale = (m: MarketDay) => missingFiles(m).length > 0 && Date.now() - Date.parse(m.builtAt) > REBUILD_INCOMPLETE_MS;

type Loaded = { market: MarketDay; stocks: Map<string, StockDay> | null; at: number };
let cache: Loaded | null = null;
let lastPublishedCheck: { at: number; date: string | null } | null = null;
let inflight: Promise<MarketDay | null> | null = null;

const parseJson = <T,>(v: T | string): T => (typeof v === "string" ? (JSON.parse(v) as T) : v);
const baseSymbol = (s: string) => s.toUpperCase().replace(/\.(NS|BO)$/, "");

/* ----------------------------------------------- refresh ----------------------------------------------- */

export type RefreshResult = { tradeDate: string | null; refreshed: boolean; sources: SourceStatus[]; backfilled: number; ms: number; note: string };

export async function refreshExchangeData(force = false): Promise<RefreshResult> {
  const start = Date.now();
  const date = await latestPublishedDate();
  lastPublishedCheck = { at: Date.now(), date };
  if (!date) return { tradeDate: null, refreshed: false, sources: [], backfilled: 0, ms: Date.now() - start, note: "NSE has not published a bhavcopy in the last 8 weekdays (or the archive is unreachable)." };

  const db = await getDb();
  if (!force && db) {
    const have = await loadFromDb(date);
    if (have && !stale(have)) {
      const missing = missingFiles(have);
      return { tradeDate: date, refreshed: false, sources: have.sources, backfilled: 0, ms: Date.now() - start, note: missing.length ? `Built recently; still waiting for: ${missing.join(", ")}.` : "Already up to date." };
    }
  }
  if (!force && !db && cache?.market.tradeDate === date && !stale(cache.market)) return { tradeDate: date, refreshed: false, sources: cache.market.sources, backfilled: 0, ms: Date.now() - start, note: "Already up to date (memory)." };

  // Download every dataset for that date in parallel; a missing file is recorded, not fatal.
  const files: Partial<Record<DatasetId, string>> = {};
  const sources: SourceStatus[] = await Promise.all(
    DATASETS.map(async (spec) => {
      try {
        const text = await download(spec.id, date);
        files[spec.id] = text;
        return { id: spec.id, page: spec.page, file: spec.file(date), url: spec.url(date), ok: true, rows: Math.max(0, text.split("\n").length - 2) };
      } catch (e) {
        return { id: spec.id, page: spec.page, file: spec.file(date), url: spec.url(date), ok: false, rows: 0, error: e instanceof Error ? e.message : String(e) };
      }
    }),
  );
  if (!files.bhav) throw new Error(`Equity bhavcopy for ${date} could not be downloaded: ${sources.find((s) => s.id === "bhav")?.error}`);

  const backfilled = db ? await backfillHistory(date) : 0;
  const history = db ? await loadHistory(date) : new Map();
  const { market, stocks } = assembleDay(files, date, sources, history);

  if (db) {
    await db.query(`insert into exchange_days (trade_date, market) values ($1, $2::jsonb) on conflict (trade_date) do update set market = excluded.market, built_at = now()`, [date, JSON.stringify(market)]);
    const rows = [...stocks.values()].map((s) => ({ symbol: s.symbol, close: s.close, volume: s.volume, delivery_pct: s.deliveryPct, data: s }));
    for (let i = 0; i < rows.length; i += 800) await insertStockRows(date, rows.slice(i, i + 800));
    await prune();
  }
  cache = { market, stocks, at: Date.now() };
  const ok = sources.filter((s) => s.ok).length;
  return { tradeDate: date, refreshed: true, sources, backfilled, ms: Date.now() - start, note: `Built ${date}: ${ok}/${sources.length} files, ${stocks.size} securities.` };
}

async function insertStockRows(date: string, rows: Array<{ symbol: string; close: number; volume: number; delivery_pct: number | null; data: StockDay | null }>) {
  const db = await getDb();
  if (!db || !rows.length) return;
  await db.query(
    `insert into exchange_stocks (trade_date, symbol, close, volume, delivery_pct, data)
     select $1, x.symbol, x.close, x.volume, x.delivery_pct, x.data
     from jsonb_to_recordset($2::jsonb) as x(symbol text, close double precision, volume double precision, delivery_pct double precision, data jsonb)
     on conflict (trade_date, symbol) do update set close = excluded.close, volume = excluded.volume, delivery_pct = excluded.delivery_pct,
       data = coalesce(excluded.data, exchange_stocks.data)`,
    [date, JSON.stringify(rows)],
  );
}

/** First run: download the previous sessions' bhavcopies so delivery/volume averages exist. */
async function backfillHistory(date: string): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const have = new Set((await db.query<{ trade_date: string }>(`select distinct trade_date from exchange_stocks where trade_date < $1`, [date])).map((r) => r.trade_date));
  const wanted = previousWeekdays(date, HISTORY_SESSIONS + 4).slice(1).filter((d) => !have.has(d));
  if (have.size >= HISTORY_SESSIONS || !wanted.length) return 0;
  let n = 0;
  for (let i = 0; i < wanted.length; i += 4) {
    await Promise.all(
      wanted.slice(i, i + 4).map(async (d) => {
        try {
          const rows = parseBhav(await download("bhav", d)).map((r) => ({ symbol: r.symbol, close: r.close, volume: r.volume, delivery_pct: r.deliveryPct, data: null }));
          for (let j = 0; j < rows.length; j += 1500) await insertStockRows(d, rows.slice(j, j + 1500));
          n += 1;
        } catch {
          /* holiday or not published — skip */
        }
      }),
    );
  }
  return n;
}

async function loadHistory(date: string): Promise<History> {
  const db = await getDb();
  const out: History = new Map();
  if (!db) return out;
  const rows = await db.query<{ symbol: string; vol: number | null; deliv: number | null; days: number | string }>(
    `with d as (select distinct trade_date from exchange_stocks where trade_date < $1 order by trade_date desc limit $2)
     select symbol, avg(volume) as vol, avg(delivery_pct) as deliv, count(*) as days
     from exchange_stocks where trade_date in (select trade_date from d) group by symbol`,
    [date, HISTORY_SESSIONS],
  );
  for (const r of rows) out.set(r.symbol, { volumeAvg: r.vol != null ? Number(r.vol) : null, deliveryAvg: r.deliv != null ? Number(r.deliv) : null, days: Number(r.days) });
  return out;
}

async function prune() {
  const db = await getDb();
  if (!db) return;
  const dates = (await db.query<{ trade_date: string }>(`select distinct trade_date from exchange_stocks order by trade_date desc`)).map((r) => r.trade_date);
  if (dates.length > KEEP_FULL_DAYS) await db.query(`update exchange_stocks set data = null where trade_date < $1 and data is not null`, [dates[KEEP_FULL_DAYS - 1]]);
  if (dates.length > KEEP_DAYS) {
    await db.query(`delete from exchange_stocks where trade_date < $1`, [dates[KEEP_DAYS - 1]]);
    await db.query(`delete from exchange_days where trade_date < $1`, [dates[KEEP_DAYS - 1]]);
  }
}

/* ------------------------------------------------ reads ------------------------------------------------ */

async function loadFromDb(date?: string): Promise<MarketDay | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = date
    ? await db.query<{ market: MarketDay | string }>(`select market from exchange_days where trade_date = $1`, [date])
    : await db.query<{ market: MarketDay | string }>(`select market from exchange_days order by trade_date desc limit 1`);
  if (!rows.length) return null;
  const market = parseJson(rows[0].market);
  cache = { market, stocks: null, at: Date.now() };
  return market;
}

/**
 * The latest exchange day. Uses the cache, then the database; if NSE has published a newer day
 * than we hold (checked at most every 20 minutes), builds it now.
 */
export async function getMarketDay(): Promise<MarketDay | null> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.market;
  inflight ??= (async () => {
    const stored = cache?.market ?? (await loadFromDb());
    if (!lastPublishedCheck || Date.now() - lastPublishedCheck.at > CHECK_MS) {
      lastPublishedCheck = { at: Date.now(), date: await latestPublishedDate() };
    }
    const latest = lastPublishedCheck.date;
    if (latest && (!stored || stored.tradeDate < latest || (stored.tradeDate === latest && stale(stored)))) {
      await refreshExchangeData();
      return cache?.market ?? stored;
    }
    if (stored && cache) cache.at = Date.now();
    return stored;
  })().finally(() => (inflight = null));
  return inflight;
}

export async function getStockDay(symbol: string, tradeDate: string): Promise<StockDay | null> {
  const sym = baseSymbol(symbol);
  if (cache?.stocks && cache.market.tradeDate === tradeDate) return cache.stocks.get(sym) ?? null;
  const db = await getDb();
  if (!db) return null;
  const rows = await db.query<{ data: StockDay | string | null }>(`select data from exchange_stocks where trade_date = $1 and symbol = $2`, [tradeDate, sym]);
  return rows[0]?.data ? parseJson(rows[0].data) : null;
}

/** Many stocks at once (for screening), keyed by NSE symbol. */
export async function getStockDays(symbols: string[], tradeDate: string): Promise<Map<string, StockDay>> {
  const syms = [...new Set(symbols.map(baseSymbol))];
  const out = new Map<string, StockDay>();
  if (cache?.stocks && cache.market.tradeDate === tradeDate) {
    for (const s of syms) {
      const v = cache.stocks.get(s);
      if (v) out.set(s, v);
    }
    return out;
  }
  const db = await getDb();
  if (!db || !syms.length) return out;
  const rows = await db.query<{ symbol: string; data: StockDay | string | null }>(`select symbol, data from exchange_stocks where trade_date = $1 and symbol = any($2::text[])`, [tradeDate, syms]);
  for (const r of rows) if (r.data) out.set(r.symbol, parseJson(r.data));
  return out;
}

async function stockHistory(symbol: string, limit = 20) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.query<{ trade_date: string; close: number; delivery_pct: number | null; volume: number }>(
    `select trade_date, close, delivery_pct, volume from exchange_stocks where symbol = $1 order by trade_date desc limit $2`,
    [baseSymbol(symbol), limit],
  );
  return rows.map((r) => ({ date: r.trade_date, close: Number(r.close), deliveryPct: r.delivery_pct != null ? Number(r.delivery_pct) : null, volume: Number(r.volume) })).reverse();
}

/** Everything the analyzer and the agents need for one stock. */
export async function getStockView(symbol: string): Promise<StockExchangeView> {
  const isBse = symbol.toUpperCase().endsWith(".BO");
  const isIndian = isBse || symbol.toUpperCase().endsWith(".NS") || !/[.^=-]/.test(symbol);
  if (!isIndian) return { symbol, tradeDate: null, stock: null, events: null, signals: [], sources: [], history: [], note: "Exchange data covers NSE/BSE-listed stocks only." };

  const [market, events] = await Promise.all([getMarketDay().catch(() => null), getCorporateEvents(symbol).catch(() => null)]);
  const stock = market ? await getStockDay(symbol, market.tradeDate).catch(() => null) : null;
  const history = await stockHistory(symbol).catch(() => []);
  const signals = interpretStock(stock, events, istToday());
  const used = new Set(signals.map((s) => s.source));
  const sources = (market?.sources ?? []).filter((s) => used.has(s.id) || s.id === "bhav");
  return {
    symbol,
    tradeDate: market?.tradeDate ?? null,
    stock,
    events,
    signals,
    sources,
    history,
    note: !market
      ? "NSE exchange files could not be loaded right now."
      : !stock
        ? `${baseSymbol(symbol)} is not in NSE's ${market.tradeDate} equity bhavcopy${isBse ? " (BSE-only listing)" : ""}.`
        : stock.historyDays === 0
          ? "No stored history yet, so delivery and volume are not compared with their averages (needs DATABASE_URL)."
          : null,
  };
}

export const datasetPage = (id: DatasetId) => DATASET[id].page;
