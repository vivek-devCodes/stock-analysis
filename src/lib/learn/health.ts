import "server-only";
import { recentScans } from "../agents/scan";
import { sendHtmlEmail } from "../email-service";
import { getMarketDay, missingFiles } from "../exchange/store";
import { notify, telegramConfigured } from "../notify";
import { getPlan, listDailyReports, planExecutedOn } from "../paper/plan-store";
import { istDate } from "../paper/rules";
import { claimOnce, listTrades } from "../paper/store";
import { fetchChart } from "../yahoo";
import { setLearned } from "./store";
import { testEmailConnection } from "../email-service";
import { morningReportStatus } from "../reports/morning-run";

/**
 * Nightly health check: did every automatic job run today? A failure is otherwise silent (a cron
 * that never fired leaves no error behind). Emails/Telegrams once a day when something is wrong,
 * and only from the late run (after 20:30 IST) so late NSE files don't raise false alarms.
 */

export type HealthCheck = { name: string; status: "ok" | "warn" | "fail"; detail: string };
export type Health = { day: string; at: string; tradingDay: boolean | null; checks: HealthCheck[]; ok: boolean; alerted: string | null };

async function isTradingDay(day: string): Promise<boolean | null> {
  const chart = await fetchChart("^NSEI", "5d", "1d").catch(() => null);
  if (!chart?.candles.length) return null;
  return chart.candles.some((c) => istDate(c.time) === day);
}

export async function runHealthCheck(opts: { alert: boolean }): Promise<Health> {
  const now = Math.floor(Date.now() / 1000);
  const day = istDate(now);
  const checks: HealthCheck[] = [];
  const tradingDay = await isTradingDay(day);

  if (tradingDay === false) {
    checks.push({ name: "Market", status: "ok", detail: "No NSE session today (weekend or holiday) — nothing to check." });
  } else {
    const market = await getMarketDay().catch(() => null);
    if (!market) checks.push({ name: "NSE files", status: "fail", detail: "No exchange data could be loaded." });
    else if (market.tradeDate !== day) checks.push({ name: "NSE files", status: "fail", detail: `Latest NSE files are for ${market.tradeDate}; today's were not downloaded.` });
    else {
      const miss = missingFiles(market);
      checks.push({ name: "NSE files", status: miss.length ? "warn" : "ok", detail: miss.length ? `Downloaded, but still missing: ${miss.join(", ")}.` : `All files for ${day} downloaded.` });
    }

    const [plan, executed, trades, reports, scans] = await Promise.all([
      getPlan(day).catch(() => null),
      planExecutedOn(day).catch(() => null),
      listTrades(500).catch(() => []),
      listDailyReports(3).catch(() => []),
      recentScans(20).catch(() => null),
    ]);
    checks.push(plan ? { name: "Tomorrow's plan", status: plan.errors.length ? "warn" : "ok", detail: `${plan.items.length} idea(s)${plan.errors.length ? ` — ${plan.errors[0]}` : ""}.` } : { name: "Tomorrow's plan", status: "fail", detail: "No plan was built after today's close." });
    const todays = trades.filter((t) => t.tradeDay === day);
    checks.push(
      executed || todays.length
        ? { name: "Intraday paper trading", status: "ok", detail: `${todays.length} paper trade(s) today${executed ? `; plan from ${executed.madeOn} executed` : ""}.` }
        : { name: "Intraday paper trading", status: "warn", detail: "No paper trades and no plan execution today — check the GitHub Actions intraday workflow (APEX_APP_URL / APEX_CRON_SECRET secrets)." },
    );
    checks.push(reports.some((r) => r.day === day) ? { name: "Daily report", status: "ok", detail: "Built." } : { name: "Daily report", status: todays.length ? "fail" : "ok", detail: todays.length ? "Not built yet." : "Nothing to report." });
    if (scans) {
      const ran = scans.some((s) => istDate(Math.floor(Date.parse(s.startedAt) / 1000)) === day);
      checks.push({ name: "Agent scans", status: ran ? "ok" : "warn", detail: ran ? "Ran today." : "No agent scan recorded today (Vercel cron or GitHub Actions)." });
    }
  }
  const smtp = await testEmailConnection().catch((e) => ({ ok: false, error: e instanceof Error ? e.message : String(e), warning: undefined }));
  checks.push(smtp.ok ? { name: "Email", status: smtp.warning ? "warn" : "ok", detail: smtp.warning ?? "Gmail login verified." } : { name: "Email", status: "fail", detail: `Emails cannot be sent: ${smtp.error}` });
  const morning = (await morningReportStatus(3).catch(() => [])).find((r) => r.day === day);
  if (tradingDay) checks.push(morning ? { name: "Morning report", status: morning.status === "sent" ? "ok" : "fail", detail: morning.status === "sent" ? "Sent this morning." : `Not delivered: ${morning.status}` } : { name: "Morning report", status: "fail", detail: "No morning report attempt today — the 08:10 IST GitHub trigger needs the APEX_APP_URL / APEX_CRON_SECRET secrets; Vercel's backup runs between 08:30 and 09:29 IST." });
  checks.push({ name: "Telegram", status: telegramConfigured() ? "ok" : "warn", detail: telegramConfigured() ? "Configured." : "TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set — no phone alerts (optional)." });

  const problems = checks.filter((c) => c.status === "fail" || (c.status === "warn" && !["Email", "Telegram"].includes(c.name)));
  const health: Health = { day, at: new Date().toISOString(), tradingDay, checks, ok: problems.length === 0, alerted: null };
  if (opts.alert && problems.length && (await claimOnce(`health-${day}`))) {
    const lines = problems.map((p) => `${p.status.toUpperCase()} — ${p.name}: ${p.detail}`);
    const res = await sendHtmlEmail(`[Apex Desk] Health check: ${problems.length} problem(s) on ${day}`, `<div style="font-family:system-ui,Arial"><h3>Health check — ${day}</h3><ul>${lines.map((l) => `<li>${l.replace(/[<>&]/g, "")}</li>`).join("")}</ul></div>`, lines.join("\n")).catch((e) => ({ success: false, error: String(e) }));
    void notify.text(`⚠️ <b>Health check ${day}</b>\n${lines.join("\n")}`).catch(() => undefined);
    health.alerted = res.success ? "sent" : `email failed: ${"error" in res ? res.error : ""}`;
  }
  await setLearned("health", health).catch(() => undefined);
  return health;
}
