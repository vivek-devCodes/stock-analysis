import "server-only";
import { sendHtmlEmail } from "../email-service";
import { notify } from "../notify";
import { settleOpenTrades } from "./engine";
import { closeOutPlan } from "./plan";
import { claimReportEmail, listDailyReports, markReportEmail, planExecutedOn, saveDailyReport } from "./plan-store";
import { listTrades } from "./store";
import type { DailyReport, PaperTrade, ReportGroup, ReportRow } from "./types";

/**
 * The daily paper-trading report: was each of the agent's decisions right? Built after the close
 * (every trade is squared off by 15:15), saved, shown on the Paper Trading page and emailed.
 */

const isClosed = (t: PaperTrade) => t.status !== "open" && t.netPnl != null;

export function group(trades: PaperTrade[]): ReportGroup {
  const closed = trades.filter(isClosed);
  const wins = closed.filter((t) => t.netPnl! > 0).length;
  return {
    trades: trades.length,
    closed: closed.length,
    wins,
    losses: closed.length - wins,
    winRate: closed.length ? wins / closed.length : null,
    netPnl: closed.reduce((a, t) => a + t.netPnl!, 0),
    targetHits: closed.filter((t) => t.status === "target").length,
    stopHits: closed.filter((t) => t.status === "stop" || t.status === "breakeven").length,
    squareOffs: closed.filter((t) => t.status === "square-off").length,
  };
}

const inr = (x: number) => `${x >= 0 ? "+" : "−"}₹${Math.abs(Math.round(x)).toLocaleString("en-IN")}`;

export function headlineFor(r: Omit<DailyReport, "headline" | "createdAt" | "emailed">): string {
  const parts: string[] = [];
  if (r.planMadeOn) {
    parts.push(`Plan from ${r.planMadeOn}: ${r.planIdeas} idea${r.planIdeas === 1 ? "" : "s"}, ${r.planEntered} entered${r.planSkipped.length ? `, ${r.planSkipped.length} skipped at the open` : ""}`);
    if (r.plan.closed) parts.push(`${r.plan.targetHits} target, ${r.plan.stopHits} stop, ${r.plan.squareOffs} square-off → ${inr(r.plan.netPnl)} (${r.plan.wins}/${r.plan.closed} right)`);
  } else parts.push("No plan was pending for this session");
  if (r.live.trades) parts.push(`Live agent run: ${r.live.trades} trade${r.live.trades === 1 ? "" : "s"}, ${inr(r.live.netPnl)} (${r.live.wins}/${r.live.closed} right)`);
  if (r.recommended.closed) parts.push(`All recommended: ${inr(r.recommended.netPnl)}, win rate ${((r.recommended.winRate ?? 0) * 100).toFixed(0)}%`);
  if (r.shadow.closed) parts.push(`Rejected (shadow) trades: ${inr(r.shadow.netPnl)} — ${r.shadow.netPnl <= 0 ? "rejecting them was right" : "rejecting them cost money"}`);
  return `${parts.join(". ")}.`;
}

export async function buildDailyReport(day: string, email = true): Promise<DailyReport | null> {
  await settleOpenTrades(true).catch(() => undefined);
  await closeOutPlan(day).catch(() => undefined);
  const trades = (await listTrades(3000)).filter((t) => t.tradeDay === day);
  const plan = await planExecutedOn(day);
  if (!trades.length && !plan) return null;

  const rec = trades.filter((t) => t.kind === "recommended");
  const rows: ReportRow[] = trades
    .map((t) => ({
      symbol: t.symbol,
      origin: (t.trigger === "plan" ? "plan" : "live") as ReportRow["origin"],
      kind: t.kind,
      side: t.side,
      decision: t.decision,
      entry: t.entry,
      exitPrice: t.exitPrice,
      status: t.status,
      netPnl: t.netPnl,
      returnPct: t.returnPct,
      correct: isClosed(t) ? t.netPnl! > 0 : null,
    }))
    .sort((a, b) => (a.origin === b.origin ? (b.netPnl ?? 0) - (a.netPnl ?? 0) : a.origin === "plan" ? -1 : 1));
  const core = {
    day,
    planMadeOn: plan?.madeOn ?? null,
    planIdeas: plan?.items.length ?? 0,
    planEntered: plan?.execution?.rows.filter((r) => r.entered).length ?? 0,
    planSkipped: plan?.execution?.rows.filter((r) => !r.entered).map((r) => ({ symbol: r.symbol, reason: r.reason })) ?? [],
    plan: group(rec.filter((t) => t.trigger === "plan")),
    live: group(rec.filter((t) => t.trigger !== "plan")),
    shadow: group(trades.filter((t) => t.kind === "shadow")),
    recommended: group(rec),
    rows,
  };
  const report: DailyReport = { ...core, headline: headlineFor(core), createdAt: new Date().toISOString(), emailed: null };
  await saveDailyReport(report);

  const stillOpen = trades.some((t) => t.status === "open");
  if (email && !stillOpen && (await claimReportEmail(day))) {
    const res = await sendHtmlEmail(`[Paper trading] ${day} — ${inr(core.recommended.netPnl)} (${core.recommended.wins}/${core.recommended.closed} right)`, html(report), text(report));
    await markReportEmail(day, res.success ? "sent" : `failed: ${res.error}`);
    void notify.text(`📊 <b>Paper trading ${day}</b>
${report.headline}`).catch(() => undefined);
    report.emailed = res.success ? "sent" : `failed: ${res.error}`;
  }
  return report;
}

export { listDailyReports };

function text(r: DailyReport): string {
  return [
    `Paper trading report — ${r.day}`,
    r.headline,
    "",
    ...r.rows.map((x) => `${x.origin.toUpperCase()} ${x.symbol} ${x.side} ${x.decision} entry ${x.entry.toFixed(2)} exit ${x.exitPrice?.toFixed(2) ?? "—"} ${x.status} ${x.netPnl != null ? inr(x.netPnl) : "open"}${x.kind === "shadow" ? " (shadow)" : ""}`),
    ...(r.planSkipped.length ? ["", "Skipped at the open:", ...r.planSkipped.map((s) => `${s.symbol}: ${s.reason}`)] : []),
    "",
    "Simulated trades only — no orders were placed. Not investment advice.",
  ].join("\n");
}

function html(r: DailyReport): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const td = 'style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:13px"';
  const row = (x: ReportRow) =>
    `<tr><td ${td}>${x.origin}</td><td ${td}><b>${esc(x.symbol)}</b>${x.kind === "shadow" ? " <i>(shadow)</i>" : ""}</td><td ${td}>${x.side} · ${x.decision}</td><td ${td}>${x.entry.toFixed(2)}</td><td ${td}>${x.exitPrice?.toFixed(2) ?? "—"}</td><td ${td}>${x.status}</td><td ${td} style="color:${(x.netPnl ?? 0) >= 0 ? "#059669" : "#dc2626"}">${x.netPnl != null ? inr(x.netPnl) : "open"}</td><td ${td}>${x.correct == null ? "—" : x.correct ? "✔" : "✘"}</td></tr>`;
  return `<div style="font-family:system-ui,Arial,sans-serif;max-width:760px">
<h2 style="margin:0 0 8px">Paper trading report — ${r.day}</h2>
<p style="font-size:14px;line-height:1.5">${esc(r.headline)}</p>
<table style="border-collapse:collapse;width:100%"><thead><tr>${["From", "Stock", "Call", "Entry", "Exit", "Result", "Net P&amp;L", "Right?"].map((h) => `<th ${td} align="left">${h}</th>`).join("")}</tr></thead><tbody>${r.rows.map(row).join("")}</tbody></table>
${r.planSkipped.length ? `<p style="font-size:13px"><b>Skipped at the open:</b><br>${r.planSkipped.map((s) => `${esc(s.symbol)} — ${esc(s.reason)}`).join("<br>")}</p>` : ""}
<p style="font-size:12px;color:#6b7280">Simulated trades only — no orders were placed. Costs of ${0.1}% round trip included. Not investment advice.</p></div>`;
}
