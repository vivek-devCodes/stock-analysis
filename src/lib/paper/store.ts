import "server-only";
import { getDb } from "../db/client";
import type { PaperRunResult, PaperTrade } from "./types";

/**
 * Paper-trade storage. Uses Postgres (DATABASE_URL) when configured; otherwise keeps trades in
 * this server process's memory, which is lost on restart / redeploy and not shared between
 * serverless instances — the page says so.
 */

const memory = { trades: new Map<string, PaperTrade>(), runs: new Map<string, PaperRunResult | null>(), flags: new Map<string, { at: string; summary: unknown }>() };

export async function isPersisted() {
  return (await getDb()) != null;
}

const parse = (v: PaperTrade | string): PaperTrade => (typeof v === "string" ? JSON.parse(v) : v);

/** Inserts the trade unless this symbol was already traded on that day. Returns true if inserted. */
export async function insertTrade(t: PaperTrade): Promise<boolean> {
  const db = await getDb();
  if (!db) {
    if ([...memory.trades.values()].some((x) => x.tradeDay === t.tradeDay && x.symbol === t.symbol)) return false;
    memory.trades.set(t.id, t);
    return true;
  }
  const rows = await db.query<{ id: string }>(
    `insert into paper_trades (id, trade_day, symbol, status, opened_at, data) values ($1, $2, $3, $4, $5, $6::jsonb)
     on conflict (trade_day, symbol) do nothing returning id`,
    [t.id, t.tradeDay, t.symbol, t.status, t.openedAt, JSON.stringify(t)],
  );
  return rows.length > 0;
}

export async function updateTrade(t: PaperTrade): Promise<void> {
  const db = await getDb();
  if (!db) {
    memory.trades.set(t.id, t);
    return;
  }
  await db.query(`update paper_trades set status = $2, data = $3::jsonb where id = $1`, [t.id, t.status, JSON.stringify(t)]);
}

export async function listTrades(limit = 1000): Promise<PaperTrade[]> {
  const db = await getDb();
  if (!db) return [...memory.trades.values()].sort((a, b) => b.openedAt.localeCompare(a.openedAt)).slice(0, limit);
  const rows = await db.query<{ data: PaperTrade | string }>(`select data from paper_trades order by trade_day desc, opened_at desc limit $1`, [limit]);
  return rows.map((r) => parse(r.data));
}

export async function openTrades(): Promise<PaperTrade[]> {
  const db = await getDb();
  if (!db) return [...memory.trades.values()].filter((t) => t.status === "open");
  const rows = await db.query<{ data: PaperTrade | string }>(`select data from paper_trades where status = 'open'`);
  return rows.map((r) => parse(r.data));
}

export async function symbolsTradedOn(day: string): Promise<Set<string>> {
  const db = await getDb();
  if (!db) return new Set([...memory.trades.values()].filter((t) => t.tradeDay === day).map((t) => t.symbol));
  const rows = await db.query<{ symbol: string }>(`select symbol from paper_trades where trade_day = $1`, [day]);
  return new Set(rows.map((r) => r.symbol));
}

/** Claims the once-a-day automatic run. Returns false if it was already claimed for this day. */
export async function claimAutoRun(day: string): Promise<boolean> {
  const key = `auto-${day}`;
  const db = await getDb();
  if (!db) {
    if (memory.runs.has(key)) return false;
    memory.runs.set(key, null);
    return true;
  }
  const rows = await db.query<{ run_key: string }>(`insert into paper_runs (run_key) values ($1) on conflict (run_key) do nothing returning run_key`, [key]);
  return rows.length > 0;
}

/** Gives the day back when an automatic run could not start (e.g. it fired before 09:30). */
export async function releaseAutoRun(day: string): Promise<void> {
  const key = `auto-${day}`;
  const db = await getDb();
  if (!db) {
    memory.runs.delete(key);
    return;
  }
  await db.query(`delete from paper_runs where run_key = $1 and summary is null`, [key]);
}

export async function saveAutoRun(day: string, result: PaperRunResult): Promise<void> {
  const key = `auto-${day}`;
  const db = await getDb();
  if (!db) {
    memory.runs.set(key, result);
    return;
  }
  await db.query(`update paper_runs set summary = $2::jsonb, at = now() where run_key = $1`, [key, JSON.stringify(result)]);
}

export async function autoRanOn(day: string): Promise<boolean> {
  const key = `auto-${day}`;
  const db = await getDb();
  if (!db) return memory.runs.has(key);
  const rows = await db.query<{ run_key: string }>(`select run_key from paper_runs where run_key = $1`, [key]);
  return rows.length > 0;
}

/* ---------------- Flags (paper_runs rows): drawdown reset, once-only emails, health ---------------- */

export async function getFlag(key: string): Promise<{ at: string; summary: unknown } | null> {
  const db = await getDb();
  if (!db) return memory.flags.get(key) ?? null;
  const rows = await db.query<{ at: string | Date; summary: unknown }>(`select at, summary from paper_runs where run_key = $1`, [key]);
  if (!rows[0]) return null;
  const at = rows[0].at instanceof Date ? rows[0].at.toISOString() : new Date(rows[0].at).toISOString();
  return { at, summary: typeof rows[0].summary === "string" ? JSON.parse(rows[0].summary) : rows[0].summary };
}

export async function setFlag(key: string, summary: unknown = null): Promise<void> {
  const db = await getDb();
  if (!db) {
    memory.flags.set(key, { at: new Date().toISOString(), summary });
    return;
  }
  await db.query(`insert into paper_runs (run_key, at, summary) values ($1, now(), $2::jsonb) on conflict (run_key) do update set at = now(), summary = excluded.summary`, [key, JSON.stringify(summary)]);
}

/** True the first time `key` is claimed (for once-only jobs such as the weekly email). */
export async function claimOnce(key: string): Promise<boolean> {
  const db = await getDb();
  if (!db) {
    if (memory.flags.has(key)) return false;
    memory.flags.set(key, { at: new Date().toISOString(), summary: null });
    return true;
  }
  const rows = await db.query<{ run_key: string }>(`insert into paper_runs (run_key) values ($1) on conflict (run_key) do nothing returning run_key`, [key]);
  return rows.length > 0;
}
