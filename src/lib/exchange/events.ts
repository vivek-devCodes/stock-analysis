import "server-only";
import { fetchQuoteSummary } from "../yahoo";
import type { CorporateEvents } from "./types";

/**
 * Results and dividend dates. NSE's corporate-actions and event-calendar pages are only served
 * through its cookie-gated website API, so this uses Yahoo Finance's calendar for the same company
 * (the source is labelled on every signal).
 */

const TTL_MS = 6 * 3600_000;
const cache = new Map<string, { at: number; value: CorporateEvents | null }>();

const dateOf = (v: unknown): string | null => {
  const raw = v && typeof v === "object" ? (v as { raw?: unknown }).raw : v;
  return typeof raw === "number" && raw > 0 ? new Date(raw * 1000 + 5.5 * 3600_000).toISOString().slice(0, 10) : null;
};

export async function getCorporateEvents(symbol: string): Promise<CorporateEvents | null> {
  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  let value: CorporateEvents | null = null;
  try {
    const r = await fetchQuoteSummary(symbol, "calendarEvents");
    const c = (r?.calendarEvents ?? null) as Record<string, unknown> | null;
    if (c) {
      const earnings = (c.earnings ?? {}) as { earningsDate?: unknown[] };
      const dates = (earnings.earningsDate ?? []).map(dateOf).filter((d): d is string => !!d).sort();
      value = { earningsDate: dates[0] ?? null, earningsDateEnd: dates[1] ?? null, exDividendDate: dateOf(c.exDividendDate), dividendDate: dateOf(c.dividendDate) };
    }
  } catch {
    value = null;
  }
  cache.set(symbol, { at: Date.now(), value });
  return value;
}
