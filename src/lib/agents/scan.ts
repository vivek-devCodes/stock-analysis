import "server-only";
import { getDb } from "../db/client";
import { getFundamentals } from "../fundamentals";
import { getLiveQuotes } from "../live";
import type { Mode, ScreenPick } from "../modes";
import { runScreen } from "../screener";
import { runAnalysis } from "./graph";
import { THRESHOLDS } from "./thresholds";
import type { AnalysisReport, Horizon, ScanItem, ScanRun, ScanSession, Validation } from "./types";

/**
 * Autonomous scanning (the agent works on its own, not only when you type a symbol).
 *
 *  1. Screen the whole universe for each horizon with the fast desk scanners.
 *  2. Shortlist the strongest candidates (by setup strength; long term also by fundamentals).
 *  3. Run the full multi-agent pipeline on each shortlisted stock — each result is saved and an
 *     APPROVED call sends its own alert immediately.
 *  4. Return a digest (and email it for the pre-/post-market sessions).
 */

export type { ScanItem, ScanRun, ScanSession } from "./types";

const SESSION_HORIZONS: Record<ScanSession, Horizon[]> = {
  premarket: ["swing", "long-term", "intraday"],
  intraday: ["intraday"],
  postmarket: ["swing", "long-term", "intraday"],
};
const MODE_OF: Record<Horizon, Mode> = { intraday: "intraday", swing: "short-term", "long-term": "long-term" };
const RANK: Record<Validation, number> = { APPROVED: 0, "APPROVED WITH CONDITIONS": 1, "NO TRADE": 2, REJECTED: 3, "INSUFFICIENT DATA": 4 };

let lastRun: ScanRun | null = null;
export const lastScanInMemory = () => lastRun;

export async function shortlist(horizon: Horizon): Promise<{ screened: number; symbols: string[] }> {
  const n = THRESHOLDS.scan.candidatesPerHorizon;
  const screen = await runScreen(MODE_OF[horizon]);
  const directional = (p: ScreenPick) => p.bias !== "neutral";
  if (horizon !== "long-term") {
    const picks = screen.picks.filter(directional).sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
    return { screened: screen.picks.length, symbols: picks.slice(0, n).map((p) => p.symbol) };
  }
  // Long term: fundamentals lead. Rank by fundamental score, keep those not in a long-term downtrend.
  const fund = await getFundamentals().catch(() => null);
  const trend = new Map(screen.picks.map((p) => [p.symbol, p.bias]));
  const ranked = (fund?.stocks ?? [])
    .filter((f) => f.scores.overall >= THRESHOLDS.fundamentals.bullish && trend.get(f.symbol) !== "bearish")
    .sort((a, b) => b.scores.overall - a.scores.overall)
    .map((f) => f.symbol);
  return { screened: fund?.stocks.length ?? screen.picks.length, symbols: ranked.slice(0, n) };
}

function toItem(r: AnalysisReport): ScanItem {
  const p = r.risk.plan;
  const tech = r.agents.find((a) => a.agent === "technical");
  const fund = r.agents.find((a) => a.agent === "fundamental");
  return {
    symbol: r.instrument.symbol,
    name: r.instrument.name,
    horizon: r.request.horizon,
    decision: r.decision,
    validation: r.validation,
    score: r.score.total,
    headline: r.headline,
    executable: r.executable,
    reportId: r.id,
    version: r.version,
    plan: p ? { direction: p.direction, entryLow: p.entryLow, entryHigh: p.entryHigh, stop: p.stop, target1: p.targets[0], riskReward: p.riskReward, quantity: p.quantity, illustrative: p.illustrativeSizing } : null,
    evidence: { probabilityType: r.expectedValue.probabilityType, hitRate: r.expectedValue.pWin, expectancyPct: r.expectedValue.expectancyPct, samples: r.expectedValue.samples },
    reasons: [tech?.summary, r.request.horizon === "long-term" ? fund?.summary : undefined].filter(Boolean) as string[],
    failedChecks: r.validator.checks.filter((c) => c.status === "fail").map((c) => `${c.name}: ${c.detail}`),
  };
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

export async function runScan(session: ScanSession): Promise<ScanRun> {
  const startedAt = new Date().toISOString();
  const errors: string[] = [];
  const nifty = (await getLiveQuotes(["^NSEI"]).catch(() => []))[0];
  const marketOpen = nifty?.marketState === "REGULAR";
  const id = `SCAN-${startedAt.slice(0, 16).replace(/[-:T]/g, "")}-${session.toUpperCase()}`;

  if (session === "intraday" && !marketOpen) {
    const run: ScanRun = {
      id, session, startedAt, finishedAt: new Date().toISOString(), marketRegime: "—", marketOpen, horizons: [],
      counts: { approved: 0, watchlist: 0, noTrade: 0 }, errors, note: "Market closed — intraday scan skipped (next-session plans come from the post-market scan).",
    };
    lastRun = run;
    return run;
  }

  const horizons: ScanRun["horizons"] = [];
  let marketRegime = "—";
  for (const horizon of SESSION_HORIZONS[session]) {
    try {
      const { screened, symbols } = await shortlist(horizon);
      const reports = await mapLimit(symbols, 2, (s) =>
        runAnalysis({ symbol: s, horizon }).catch((e) => {
          errors.push(`${s} (${horizon}): ${e instanceof Error ? e.message : String(e)}`);
          return null;
        }),
      );
      const items = reports.filter((r): r is AnalysisReport => r != null).map((r) => {
        if (r.marketRegime && r.marketRegime !== "Unknown") marketRegime = r.marketRegime;
        return toItem(r);
      });
      items.sort((a, b) => RANK[a.validation] - RANK[b.validation] || (b.score ?? 0) - (a.score ?? 0));
      horizons.push({ horizon, screened, shortlisted: symbols, items });
    } catch (e) {
      errors.push(`${horizon} screen failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const all = horizons.flatMap((h) => h.items);
  const run: ScanRun = {
    id,
    session,
    startedAt,
    finishedAt: new Date().toISOString(),
    marketRegime,
    marketOpen,
    horizons,
    counts: {
      approved: all.filter((i) => i.validation === "APPROVED").length,
      watchlist: all.filter((i) => i.validation === "APPROVED WITH CONDITIONS").length,
      noTrade: all.filter((i) => !["APPROVED", "APPROVED WITH CONDITIONS"].includes(i.validation)).length,
    },
    errors,
    note:
      session === "intraday"
        ? "Live intraday scan."
        : marketOpen
          ? "Market open."
          : "Market closed — intraday items are a next-session watchlist with conditional triggers, not executable orders.",
  };
  lastRun = run;
  await saveScan(run).catch((e) => errors.push(`save failed: ${e instanceof Error ? e.message : String(e)}`));
  return run;
}

/* ----------------------------------------- persistence ----------------------------------------- */

/** IST date (+ 30-minute slot for intraday) — one digest per pre/post-market session per day. */
export function runKey(run: Pick<ScanRun, "session" | "startedAt">) {
  const ist = new Date(Date.parse(run.startedAt) + 5.5 * 3600_000).toISOString();
  const slot = run.session === "intraday" ? `-${ist.slice(11, 13)}${Number(ist.slice(14, 16)) < 30 ? "00" : "30"}` : "";
  return `${run.session}-${ist.slice(0, 10)}${slot}`;
}

async function saveScan(run: ScanRun) {
  const db = await getDb();
  if (!db) return;
  await db.query(
    `insert into scan_runs (id, session, run_key, started_at, finished_at, summary) values ($1, $2, $3, $4, $5, $6::jsonb)
     on conflict (run_key) do update set id = excluded.id, finished_at = excluded.finished_at, summary = excluded.summary`,
    [run.id, run.session, runKey(run), run.startedAt, run.finishedAt, JSON.stringify(run)],
  );
}

/** Returns true the first time a digest for this run key is claimed (prevents duplicate emails). */
export async function claimDigest(run: ScanRun): Promise<boolean> {
  const db = await getDb();
  if (!db) return true;
  const rows = await db.query(`update scan_runs set emailed = 'pending' where run_key = $1 and emailed is null returning id`, [runKey(run)]);
  return rows.length > 0;
}

export async function markDigest(run: ScanRun, status: string) {
  const db = await getDb();
  if (!db) return;
  await db.query(`update scan_runs set emailed = $2 where run_key = $1`, [runKey(run), status.slice(0, 200)]);
}

export async function recentScans(limit = 10): Promise<ScanRun[] | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.query<{ summary: ScanRun | string }>(`select summary from scan_runs order by started_at desc limit $1`, [limit]);
  return rows.map((r) => (typeof r.summary === "string" ? JSON.parse(r.summary) : r.summary));
}
