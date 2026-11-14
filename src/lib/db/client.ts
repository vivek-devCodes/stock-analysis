import "server-only";
import postgres from "postgres";
import { SCHEMA } from "./schema";

/**
 * Minimal database interface so the same SQL runs on hosted Postgres (Neon / Supabase / any
 * Postgres via DATABASE_URL) and on PGlite in tests. JSON values are passed as strings and
 * cast with ::jsonb in SQL, which works the same on both.
 */
export type Db = { query: <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<T[]> };

let db: Db | null | undefined;
let schemaReady: Promise<void> | null = null;

function connect(): Db | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  const local = /localhost|127\.0\.0\.1/.test(url);
  const sql = postgres(url, {
    ssl: local ? false : "require",
    max: 3, // serverless: keep the pool small
    idle_timeout: 20,
    prepare: false, // works behind PgBouncer / Neon pooled endpoints
  });
  return { query: async <T,>(text: string, params: unknown[] = []) => (await sql.unsafe(text, params as never[])) as unknown as T[] };
}

/** The database, or null when DATABASE_URL is not configured (the app then runs without history). */
export async function getDb(): Promise<Db | null> {
  if (db === undefined) db = connect();
  if (!db) return null;
  schemaReady ??= (async () => {
    for (const stmt of SCHEMA) await db!.query(stmt);
  })().catch((e) => {
    schemaReady = null;
    throw e;
  });
  await schemaReady;
  return db;
}

/** Tests only: swap in a PGlite-backed Db. */
export function setDbForTesting(testDb: Db | null) {
  db = testDb;
  schemaReady = null;
}
