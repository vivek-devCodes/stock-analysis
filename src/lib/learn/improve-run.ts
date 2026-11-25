import "server-only";
import { mapLimit } from "../agents/scan";
import { listTrades } from "../paper/store";
import type { Candle } from "../types";
import { fetchChart } from "../yahoo";
import { buildImproveState, DEFAULT_TUNING, diagnoseTrade, type Diagnosis, type ImproveState, type Replayable, type Tuning } from "./improve";
import { getLearned, setLearned } from "./store";

/**
 * Nightly self-improvement run: post-mortem every closed paper trade, re-test the exits on the
 * trades' own candles, update the setup ledger and the tuning the engine trades with tomorrow.
 * Yahoo keeps 5-minute candles for ~60 days, so diagnosis and exit tests cover that window; the
 * setup ledger uses every closed trade.
 */
const KEY = "improve";
const CANDLE_DAYS = 55;

const istDay = (unix: number) => new Date((unix + 19800) * 1000).toISOString().slice(0, 10);

/** All 5-minute candles of the last ~60 days for a symbol, grouped by IST day. */
async function candlesByDay(symbol: string): Promise<Map<string, Candle[]>> {
  const { candles } = await fetchChart(symbol, "60d", "5m");
  const out = new Map<string, Candle[]>();
  for (const c of candles) {
    const d = istDay(c.time);
    const list = out.get(d) ?? [];
    list.push(c);
    out.set(d, list);
  }
  return out;
}

export async function runImprovement(): Promise<{ trades: number; diagnosed: number; changes: string[]; defensive: boolean }> {
  const all = await listTrades(2000);
  const closed = all.filter((t) => t.status !== "open" && t.exitPrice != null);
  const since = new Date(Date.now() - CANDLE_DAYS * 86400_000).toISOString().slice(0, 10);
  const recent = closed.filter((t) => t.tradeDay >= since);

  const symbols = [...new Set(recent.map((t) => t.symbol))];
  const bySymbol = new Map<string, Map<string, Candle[]>>();
  await mapLimit(["^NSEI", ...symbols], 3, async (s) => {
    bySymbol.set(s, await candlesByDay(s).catch(() => new Map()));
  });
  const nifty = bySymbol.get("^NSEI") ?? new Map<string, Candle[]>();

  const diagnoses: Diagnosis[] = [];
  const replayable: Replayable[] = [];
  for (const t of recent) {
    const day = bySymbol.get(t.symbol)?.get(t.tradeDay) ?? [];
    const d = diagnoseTrade(t, day, nifty.get(t.tradeDay) ?? []);
    if (d) diagnoses.push(d);
    if (day.length) replayable.push({ trade: t, candles: day });
  }

  const previous = (await getLearned<ImproveState>(KEY).catch(() => null))?.data.tuning ?? null;
  const state = buildImproveState({ closed, diagnoses, replayable, previous });
  await setLearned(KEY, state);
  resetImproveCache();
  return { trades: closed.length, diagnosed: diagnoses.length, changes: state.changes, defensive: state.defensive };
}

/* ------------------------------------------ runtime access (cached) ------------------------------------------ */

let cache: { at: number; state: ImproveState | null } | null = null;
export const resetImproveCache = () => {
  cache = null;
};

/** What the engine has learned, for the entry paths. null when adaptive learning is switched off. */
export async function currentImprovement(): Promise<ImproveState | null> {
  if (process.env.ADAPTIVE_WEIGHTS === "off") return null;
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache.state;
  const state = (await getLearned<ImproveState>(KEY).catch(() => null))?.data ?? null;
  cache = { at: Date.now(), state };
  return state;
}

export async function currentTuning(): Promise<Tuning> {
  return (await currentImprovement())?.tuning ?? DEFAULT_TUNING;
}

/** Is NIFTY moving in this direction since today's open? null when unknown (filter then does not block). */
export async function marketAgrees(side: "long" | "short", atUnix: number): Promise<boolean | null> {
  const { candles } = await fetchChart("^NSEI", "1d", "5m").catch(() => ({ candles: [] as Candle[] }));
  const day = istDay(atUnix);
  const bars = candles.filter((c) => istDay(c.time) === day && c.time <= atUnix).sort((a, b) => a.time - b.time);
  if (bars.length < 2) return null;
  const move = bars.at(-1)!.close - bars[0].open;
  if (Math.abs(move) / bars[0].open < 0.0005) return null;
  return side === "long" ? move > 0 : move < 0;
}
