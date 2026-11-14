// Ticker validation shared by the API routes and the daily pipeline.

export const MAX_WATCHLIST = 25;
const SYMBOL_RE = /^[A-Z0-9^][A-Z0-9.\-=&^]{0,19}$/;

/** Uppercases, drops anything that doesn't look like a Yahoo ticker, de-duplicates, caps the length. */
export function sanitizeSymbols(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const s = raw.trim().toUpperCase();
    if (SYMBOL_RE.test(s)) out.add(s);
    if (out.size >= MAX_WATCHLIST) break;
  }
  return [...out];
}

/** "RELIANCE.NS, TCS.NS" → ["RELIANCE.NS", "TCS.NS"] */
export function parseSymbolList(value: string | undefined): string[] {
  return (value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}
