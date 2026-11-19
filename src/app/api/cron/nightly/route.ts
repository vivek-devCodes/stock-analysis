import type { NextRequest } from "next/server";
import { safeEqual } from "@/lib/auth/password";
import { getMarketDay, missingFiles, refreshExchangeData } from "@/lib/exchange/store";
import { runHealthCheck } from "@/lib/learn/health";
import { runLearning } from "@/lib/learn/scorecard";
import { sendWeeklyScorecard } from "@/lib/learn/weekly";
import { buildNextSessionPlan } from "@/lib/paper/plan";
import { buildDailyReport } from "@/lib/paper/report";
import { istDate } from "@/lib/paper/rules";
import { runPortfolio } from "@/lib/portfolio/engine";

/**
 * After-the-close job (Vercel Cron 19:15 IST; GitHub Actions 21:00 IST runs each step separately),
 * Mon–Fri. Steps, in order:
 *   1. exchange  — download today's NSE/BSE files (bhavcopy, F&O, deals, surveillance…)
 *   2. report    — score today's paper trades and email the daily report (closes out the plan)
 *   3. learn     — score NSE signals against the next session, agent vs baselines, adapt weights
 *   4. plan      — build tomorrow's intraday plan with the full multi-agent analysis
 *   5. portfolio — momentum + quality portfolio: monthly rebalance, nightly value vs NIFTY
 *   6. weekly    — the weekly scorecard email (Fridays)
 *   7. health    — did every automatic job run today? Alerts after 20:30 IST if not
 * Every step is idempotent. ?step=<name> runs one step; &force=1 rebuilds / forces it.
 * Requires "Authorization: Bearer <CRON_SECRET>".
 */
export const maxDuration = 300;

const STEPS = ["exchange", "report", "learn", "plan", "portfolio", "weekly", "health"] as const;
type Step = (typeof STEPS)[number];
const ms = (start: number) => Date.now() - start;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const step = request.nextUrl.searchParams.get("step") ?? "all";
  if (step !== "all" && !STEPS.includes(step as Step)) return Response.json({ error: `step must be all or one of ${STEPS.join(", ")}` }, { status: 400 });
  const force = request.nextUrl.searchParams.get("force") === "1";
  const started = Date.now();
  const nowS = Math.floor(started / 1000);
  const today = istDate(nowS);
  const istMinutes = Math.floor(((nowS + 19_800) % 86_400) / 60);
  const out: Record<string, unknown> = { today, step };
  const errors: string[] = [];
  const runs = (s: Step) => step === "all" || step === s;

  const attempt = async (name: Step, fn: () => Promise<unknown>) => {
    if (!runs(name)) return;
    // "all" stops before the heavy steps if the function is close to its time limit; the 21:00
    // GitHub run calls each step on its own.
    if (step === "all" && ms(started) > 170_000 && (name === "plan" || name === "portfolio")) {
      out[name] = { skipped: "Out of time in this run — the 21:00 IST run does it." };
      return;
    }
    const t = Date.now();
    try {
      const r = await fn();
      out[name] = r && typeof r === "object" ? { ...(r as object), ms: ms(t) } : r;
    } catch (e) {
      errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  await attempt("exchange", async () => {
    const r = await refreshExchangeData(force);
    return { tradeDate: r.tradeDate, refreshed: r.refreshed, backfilled: r.backfilled, files: r.sources.map((s) => `${s.id}:${s.ok ? "ok" : s.error}`), note: r.note };
  });

  await attempt("report", async () => {
    const r = await buildDailyReport(today);
    return r ? { headline: r.headline, emailed: r.emailed } : { skipped: "No paper trades or executed plan today." };
  });

  await attempt("learn", async () => {
    const r = await runLearning();
    return { signalDaysScored: r.signalDays, baselineDays: r.baselineDays, weightsAdapted: r.weights.adapted, notes: r.weights.notes, muted: r.muted };
  });

  await attempt("plan", async () => {
    const market = await getMarketDay();
    const waitingForFo = market != null && missingFiles(market).includes("fo") && istMinutes < 20 * 60 + 30;
    if (!force && market?.tradeDate === today && waitingForFo) return { skipped: "Waiting for NSE's F&O bhavcopy (not published yet) — the 21:00 IST run builds the plan." };
    if (!force && market?.tradeDate !== today) return { skipped: market ? `Latest NSE files are for ${market.tradeDate}: today was a holiday or its files are not published yet (the 21:00 IST run retries).` : "NSE files unavailable." };
    const p = await buildNextSessionPlan(force);
    return { madeOn: p.madeOn, status: p.status, exchangeDate: p.exchangeDate, screened: p.screened, regime: p.regime?.level ?? null, items: p.items.map((i) => `${i.symbol} ${i.side} ${i.decision}`), skipped: p.skipped.length, errors: p.errors };
  });

  await attempt("portfolio", async () => {
    const market = await getMarketDay().catch(() => null);
    if (!force && market?.tradeDate !== today) return { skipped: "No session today (or NSE files not in yet)." };
    return runPortfolio(force);
  });

  await attempt("weekly", async () => {
    const weekday = new Date((nowS + 19_800) * 1000).getUTCDay();
    if (!force && weekday !== 5) return { skipped: "The weekly scorecard is sent on Fridays." };
    return sendWeeklyScorecard(force);
  });

  await attempt("health", async () => {
    const h = await runHealthCheck({ alert: istMinutes >= 20 * 60 + 30 });
    return { ok: h.ok, tradingDay: h.tradingDay, alerted: h.alerted, problems: h.checks.filter((c) => c.status !== "ok").map((c) => `${c.name}: ${c.detail}`) };
  });

  out.errors = errors;
  out.ms = ms(started);
  const ranSomething = STEPS.some((s) => s in out);
  return Response.json(out, { status: errors.length && !ranSomething ? 500 : 200 });
}
