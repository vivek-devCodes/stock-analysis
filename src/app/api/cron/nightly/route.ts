import type { NextRequest } from "next/server";
import { safeEqual } from "@/lib/auth/password";
import { getMarketDay, missingFiles, refreshExchangeData } from "@/lib/exchange/store";
import { buildNextSessionPlan } from "@/lib/paper/plan";
import { buildDailyReport } from "@/lib/paper/report";
import { istDate } from "@/lib/paper/rules";

/**
 * After-the-close job (Vercel Cron 19:15 IST, GitHub Actions backup 21:00 IST), Mon–Fri:
 *   1. report   — score today's paper trades (plan + live) and email the report
 *   2. exchange — download today's NSE/BSE files (bhavcopy, F&O, deals, surveillance…)
 *   3. plan     — build tomorrow's intraday plan with the full multi-agent analysis
 * Every step is idempotent. ?step=report|exchange|plan runs one step; &force=1 rebuilds.
 * Requires "Authorization: Bearer <CRON_SECRET>".
 */
export const maxDuration = 300;

const ms = (start: number) => Date.now() - start;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const step = request.nextUrl.searchParams.get("step") ?? "all";
  const force = request.nextUrl.searchParams.get("force") === "1";
  const today = istDate(Math.floor(Date.now() / 1000));
  const out: Record<string, unknown> = { today, step };
  const errors: string[] = [];

  if (step === "all" || step === "report") {
    const t = Date.now();
    try {
      const r = await buildDailyReport(today);
      out.report = r ? { headline: r.headline, emailed: r.emailed, ms: ms(t) } : { skipped: "No paper trades or executed plan today.", ms: ms(t) };
    } catch (e) {
      errors.push(`report: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (step === "all" || step === "exchange") {
    const t = Date.now();
    try {
      const r = await refreshExchangeData(force);
      out.exchange = { tradeDate: r.tradeDate, refreshed: r.refreshed, backfilled: r.backfilled, files: r.sources.map((s) => `${s.id}:${s.ok ? "ok" : s.error}`), note: r.note, ms: ms(t) };
    } catch (e) {
      errors.push(`exchange: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (step === "all" || step === "plan") {
    const t = Date.now();
    try {
      const market = await getMarketDay();
      const istMinutes = Math.floor(((Date.now() / 1000 + 19_800) % 86_400) / 60);
      const waitingForFo = market != null && missingFiles(market).includes("fo") && istMinutes < 20 * 60 + 30;
      if (!force && market?.tradeDate === today && waitingForFo) {
        out.plan = { skipped: "Waiting for NSE's F&O bhavcopy (not published yet) — the 21:00 IST run builds the plan.", ms: ms(t) };
      } else if (!force && market?.tradeDate !== today) {
        out.plan = { skipped: market ? `Latest NSE files are for ${market.tradeDate}: today was a holiday or its files are not published yet (the 21:00 IST run retries).` : "NSE files unavailable.", ms: ms(t) };
      } else {
        const p = await buildNextSessionPlan(force);
        out.plan = { madeOn: p.madeOn, status: p.status, exchangeDate: p.exchangeDate, screened: p.screened, items: p.items.map((i) => `${i.symbol} ${i.side} ${i.decision}`), skipped: p.skipped.length, errors: p.errors, ms: ms(t) };
      }
    } catch (e) {
      errors.push(`plan: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  out.errors = errors;
  return Response.json(out, { status: errors.length && Object.keys(out).length <= 3 ? 500 : 200 });
}
