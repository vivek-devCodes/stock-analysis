import "server-only";
import { getDb } from "./db/client";
import { parseSymbolList, sanitizeSymbols } from "./symbols";

/**
 * The watchlist the scheduled morning report reads. The browser keeps a copy in localStorage for
 * speed, but this table is the source of truth so the 08:30 job (which has no browser) sees it.
 * Order: the DB table, then WATCHLIST_SYMBOLS, then a small default.
 */
const DEFAULT = ["RELIANCE.NS", "TCS.NS", "INFY.NS", "HDFCBANK.NS", "SBIN.NS"];
let memory: string[] | null = null;

export async function getServerWatchlist(): Promise<{ symbols: string[]; source: "db" | "env" | "default" }> {
  const db = await getDb();
  const stored = db
    ? (await db.query<{ symbol: string }>(`select symbol from watchlist order by position, added_at`)).map((r) => r.symbol)
    : memory ?? [];
  if (stored.length) return { symbols: stored, source: "db" };
  const env = parseSymbolList(process.env.WATCHLIST_SYMBOLS);
  if (env.length) return { symbols: env, source: "env" };
  return { symbols: [...DEFAULT], source: "default" };
}

/** Replace the whole watchlist (the order given is kept). */
export async function setServerWatchlist(input: unknown): Promise<string[]> {
  const symbols = sanitizeSymbols(input);
  const db = await getDb();
  if (!db) {
    memory = symbols;
    return symbols;
  }
  await db.query(`delete from watchlist where not (symbol = any($1::text[]))`, [symbols]);
  if (symbols.length) {
    await db.query(
      `insert into watchlist (symbol, position)
       select s, i::int from unnest($1::text[]) with ordinality as t(s, i)
       on conflict (symbol) do update set position = excluded.position`,
      [symbols],
    );
  }
  return symbols;
}

/** Does the DB hold a saved watchlist yet? (Used once to migrate the browser copy.) */
export async function hasServerWatchlist(): Promise<boolean> {
  const db = await getDb();
  if (!db) return memory !== null;
  const rows = await db.query<{ n: string | number }>(`select count(*) as n from watchlist`);
  return Number(rows[0]?.n ?? 0) > 0;
}
