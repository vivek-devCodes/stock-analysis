import "server-only";
import { isNseSymbol, nseLiveQuote } from "./nse-live";
import type { LiveQuote } from "./types";
import { fetchQuotesBatch } from "./yahoo";

/**
 * Live quote layer. Yahoo gives every symbol in one batch call (NSE/BSE are 15 min delayed there,
 * US indices and crypto are live). For NSE symbols we also ask NSE's official live server
 * (~1 min) and keep whichever quote is newer.
 */

const CACHE_MS = 5_000;
const cache = new Map<string, { at: number; quote: LiveQuote }>();

export async function getLiveQuotes(symbols: string[]): Promise<LiveQuote[]> {
  const now = Date.now();
  const fresh = new Map<string, LiveQuote>();
  const stale: string[] = [];
  for (const s of symbols) {
    const hit = cache.get(s);
    if (hit && now - hit.at < CACHE_MS) fresh.set(s, hit.quote);
    else stale.push(s);
  }

  if (stale.length) {
    const [yahoo, nse] = await Promise.all([
      fetchQuotesBatch(stale).catch(() => [] as LiveQuote[]),
      Promise.all(stale.map((s) => (isNseSymbol(s) ? nseLiveQuote(s) : Promise.resolve(null)))),
    ]);
    const bySymbol = new Map(yahoo.map((q) => [q.symbol, q]));
    stale.forEach((s, i) => {
      const y = bySymbol.get(s);
      const n = nse[i];
      // NSE quotes don't carry a market state; borrow Yahoo's when we have it.
      const best = n && (!y || n.time >= y.time) ? { ...n, marketState: y?.marketState ?? n.marketState } : y;
      if (best) {
        fresh.set(s, best);
        cache.set(s, { at: now, quote: best });
      }
    });
  }

  return symbols.flatMap((s) => {
    const q = fresh.get(s);
    return q ? [q] : [];
  });
}
