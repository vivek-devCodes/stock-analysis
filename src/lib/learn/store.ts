import "server-only";
import { getDb } from "../db/client";
import type { MarketDay, StockDay } from "../exchange/types";
import type { BaselineDay, SignalObs } from "./core";

/** Learning-loop storage. Needs Postgres; without DATABASE_URL these read as empty. */

const parse = <T,>(v: T | string): T => (typeof v === "string" ? (JSON.parse(v) as T) : v);
const memory = { learned: new Map<string, unknown>() };

export async function scoredSignalDays(): Promise<Set<string>> {
  const db = await getDb();
  if (!db) return new Set();
  const rows = await db.query<{ day: string }>(`select distinct day from signal_days`);
  return new Set(rows.map((r) => r.day));
}

/** Saves one day's signal results. A "_scored" marker row records the day even when it had no signals. */
export async function saveSignalDay(day: string, rows: SignalObs[]): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const all = [...rows, { key: "_scored", id: "_scored", label: "", effect: "base" as const, n: 0, correct: 0, sumRet: 0, correctCc: 0, sumRetCc: 0 }];
  await db.query(
    `insert into signal_days (day, key, id, label, effect, n, correct, sum_ret, correct_cc, sum_ret_cc)
     select $1, x.key, x.id, x.label, x.effect, x.n, x.correct, x."sumRet", x."correctCc", x."sumRetCc"
     from jsonb_to_recordset($2::jsonb) as x(key text, id text, label text, effect text, n int, correct int, "sumRet" float8, "correctCc" int, "sumRetCc" float8)
     on conflict (day, key) do update set n = excluded.n, correct = excluded.correct, sum_ret = excluded.sum_ret, correct_cc = excluded.correct_cc, sum_ret_cc = excluded.sum_ret_cc, label = excluded.label`,
    [day, JSON.stringify(all)],
  );
}

export async function listSignalDays(sinceDay = "0000-00-00"): Promise<Array<SignalObs & { day: string }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.query<{ day: string; key: string; id: string; label: string; effect: string; n: number; correct: number; sum_ret: number; correct_cc: number; sum_ret_cc: number }>(
    `select * from signal_days where key <> '_scored' and day >= $1`,
    [sinceDay],
  );
  return rows.map((r) => ({
    day: r.day,
    key: r.key,
    id: r.id,
    label: r.label,
    effect: r.effect as SignalObs["effect"],
    n: Number(r.n),
    correct: Number(r.correct),
    sumRet: Number(r.sum_ret),
    correctCc: Number(r.correct_cc),
    sumRetCc: Number(r.sum_ret_cc),
  }));
}

export async function saveBaselineDay(b: BaselineDay): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.query(`insert into baseline_days (day, data) values ($1, $2::jsonb) on conflict (day) do update set data = excluded.data`, [b.day, JSON.stringify(b)]);
}

export async function listBaselineDays(limit = 250): Promise<BaselineDay[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.query<{ data: BaselineDay | string }>(`select data from baseline_days order by day desc limit $1`, [limit]);
  return rows.map((r) => parse(r.data));
}

export async function getLearned<T>(key: string): Promise<{ data: T; updatedAt: string } | null> {
  const db = await getDb();
  if (!db) {
    const v = memory.learned.get(key) as { data: T; updatedAt: string } | undefined;
    return v ?? null;
  }
  const rows = await db.query<{ data: T | string; updated_at: string | Date }>(`select data, updated_at from learned where key = $1`, [key]);
  if (!rows[0]) return null;
  return { data: parse(rows[0].data), updatedAt: new Date(rows[0].updated_at).toISOString() };
}

export async function setLearned(key: string, data: unknown): Promise<void> {
  const db = await getDb();
  if (!db) {
    memory.learned.set(key, { data, updatedAt: new Date().toISOString() });
    return;
  }
  await db.query(`insert into learned (key, data) values ($1, $2::jsonb) on conflict (key) do update set data = excluded.data, updated_at = now()`, [key, JSON.stringify(data)]);
}

/** Every stored exchange day (oldest first) and whether its full per-stock records are still kept. */
export async function exchangeDates(): Promise<Array<{ date: string; full: boolean }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.query<{ trade_date: string; full: boolean }>(
    `select trade_date, bool_or(data is not null) as full from exchange_stocks group by trade_date order by trade_date`,
  );
  return rows.map((r) => ({ date: r.trade_date, full: Boolean(r.full) }));
}

/** Full records of a day's liquid EQ stocks (for scoring signals). */
export async function stocksOn(date: string, minTurnoverLacs: number): Promise<StockDay[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.query<{ data: StockDay | string }>(
    `select data from exchange_stocks where trade_date = $1 and data is not null and data->>'series' = 'EQ' and (data->>'turnoverLacs')::float8 >= $2`,
    [date, minTurnoverLacs],
  );
  return rows.map((r) => parse(r.data));
}

export async function marketOn(date: string): Promise<MarketDay | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.query<{ market: MarketDay | string }>(`select market from exchange_days where trade_date = $1`, [date]);
  return rows[0] ? parse(rows[0].market) : null;
}

/** Open and close of every stock on a day (from the bhavcopy). */
export async function openCloseOn(date: string): Promise<Map<string, { open: number; close: number }>> {
  const db = await getDb();
  const out = new Map<string, { open: number; close: number }>();
  if (!db) return out;
  const rows = await db.query<{ symbol: string; open: number | null; close: number | null }>(
    `select symbol, (data->>'open')::float8 as open, close from exchange_stocks where trade_date = $1 and data is not null`,
    [date],
  );
  for (const r of rows) if (r.open != null && r.close != null) out.set(r.symbol, { open: Number(r.open), close: Number(r.close) });
  return out;
}
