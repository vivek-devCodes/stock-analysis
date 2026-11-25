import "server-only";
import { getDb } from "../db/client";
import { sendHtmlEmail } from "../email-service";
import { runSession } from "../agents/run-session";
import { recentScans, type ScanRun } from "../agents/scan";
import { collectMorningData, istDay, renderMorningReport } from "./morning";

/**
 * Sends the morning report once per IST weekday. Two schedulers call it (GitHub Actions at 08:15
 * and Vercel Cron at 08:30 IST) so a late or missed trigger still gets the email out; the claim
 * below makes sure only the first one sends. A failed attempt can be retried by the next trigger.
 */

async function claim(day: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return true;
  const rows = await db.query(
    `insert into morning_reports (day, status) values ($1, 'pending')
     on conflict (day) do update set status = 'pending', created_at = now()
       where morning_reports.status like 'failed%'
          or (morning_reports.status = 'pending' and morning_reports.created_at < now() - interval '10 minutes')
     returning day`,
    [day],
  );
  return rows.length > 0;
}

async function finish(day: string, status: string, html: string | null) {
  const db = await getDb();
  if (!db) return;
  await db.query(`update morning_reports set status = $2, html = coalesce($3, html) where day = $1`, [day, status.slice(0, 300), html]);
}

const isWeekendIst = (day: string) => [0, 6].includes(new Date(`${day}T12:00:00+05:30`).getUTCDay());

export async function sendMorningReport(opts: { force?: boolean } = {}) {
  const day = istDay();
  if (!opts.force && isWeekendIst(day)) return { day, status: "skipped: weekend" };
  if (!opts.force && !(await claim(day))) return { day, status: "already sent (or in progress) today" };

  let run: ScanRun | null = null;
  let scanError: string | null = null;
  try {
    ({ run } = await runSession("premarket", { email: false }));
  } catch (error) {
    scanError = error instanceof Error ? error.message : String(error);
  }
  const data = await collectMorningData(run);
  if (scanError) data.issues.unshift(`Pre-market scan failed: ${scanError}`);
  const report = renderMorningReport(data);
  const res = await sendHtmlEmail(report.subject, report.html, report.text);
  const status = res.success ? "sent" : `failed: ${res.error}`;
  await finish(day, status, report.html);
  return { day, status, subject: report.subject, plan: data.plan?.items.length ?? 0, calls: data.calls.length, watchlist: data.watchlist.length, issues: data.issues };
}

/** Render today's report without sending it, from the latest pre-market scan already stored. */
export async function previewMorningReport() {
  const scans = await recentScans(10).catch(() => null);
  const run = scans?.find((s) => s.session === "premarket") ?? null;
  return renderMorningReport(await collectMorningData(run));
}

export async function morningReportStatus(limit = 10) {
  const db = await getDb();
  if (!db) return [];
  return db.query<{ day: string; status: string; created_at: string }>(`select day, status, created_at from morning_reports order by day desc limit $1`, [limit]);
}
