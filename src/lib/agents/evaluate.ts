import "server-only";
import { closeRecommendation, openRecommendations, type OpenRec } from "../db/repo";
import { fetchChart } from "../yahoo";

/**
 * Performance tracking (spec §13): walks the candles after each open recommendation and records
 * whether its stop or first target was hit first, or that it expired. If both are touched in the
 * same candle the stop is assumed first (conservative). Returns are net of the round-trip cost.
 */

const toMs = (v: string | Date) => (v instanceof Date ? v.getTime() : Date.parse(v));

export async function evaluateOpenRecommendations(): Promise<{ checked: number; closed: number; errors: string[] }> {
  const recs = await openRecommendations();
  let closed = 0;
  const errors: string[] = [];
  for (const r of recs) {
    try {
      if (await evaluateOne(r)) closed += 1;
    } catch (e) {
      errors.push(`${r.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { checked: recs.length, closed, errors };
}

async function evaluateOne(r: OpenRec): Promise<boolean> {
  const { candles } = r.horizon === "intraday" ? await fetchChart(r.symbol, "5d") : await fetchChart(r.symbol, "1y", "1d");
  const from = toMs(r.created_at) / 1000;
  const expires = toMs(r.expires_at);
  const long = r.direction === "long";
  const cost = (r.cost_rate ?? 0) * 100;
  const ret = (exit: number) => ((long ? exit - r.entry : r.entry - exit) / r.entry) * 100 - cost;

  for (const c of candles) {
    if (c.time <= from) continue;
    const stopHit = long ? c.low <= r.stop : c.high >= r.stop;
    const targetHit = long ? c.high >= r.target : c.low <= r.target;
    if (stopHit) {
      await closeRecommendation(r.id, "stop-hit", ret(r.stop), new Date(c.time * 1000));
      return true;
    }
    if (targetHit) {
      await closeRecommendation(r.id, "target-hit", ret(r.target), new Date(c.time * 1000));
      return true;
    }
  }
  if (Date.now() > expires && candles.length) {
    const last = candles.at(-1)!;
    await closeRecommendation(r.id, "expired", ret(last.close), new Date(last.time * 1000));
    return true;
  }
  return false;
}
