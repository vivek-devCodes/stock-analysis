import "server-only";
import { sendHtmlEmail } from "../email-service";
import { notify } from "../notify";
import { istDate } from "../paper/rules";
import { groupStats } from "../paper/stats";
import { claimOnce, listTrades } from "../paper/store";
import { getScorecard } from "./scorecard";

/**
 * Weekly scorecard email (Fridays after the close): the week's paper results, the agent against
 * the baselines, the best and worst signals, score calibration, and the self-review suggestions.
 */

const pct = (x: number | null | undefined, d = 1) => (x == null ? "—" : `${(x * 100).toFixed(d)}%`);
const signed = (x: number | null | undefined, d = 2) => (x == null ? "—" : `${x >= 0 ? "+" : ""}${x.toFixed(d)}%`);
const inr = (x: number) => `${x >= 0 ? "+" : "−"}₹${Math.abs(Math.round(x)).toLocaleString("en-IN")}`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export async function sendWeeklyScorecard(force = false): Promise<{ sent: boolean; detail: string }> {
  const now = Math.floor(Date.now() / 1000);
  const today = istDate(now);
  if (!force && !(await claimOnce(`weekly-${today}`))) return { sent: false, detail: "Already sent today." };

  const [card, trades] = await Promise.all([getScorecard(), listTrades(5000)]);
  const weekAgo = istDate(now - 7 * 86400);
  const week = trades.filter((t) => t.tradeDay > weekAgo);
  const wRec = groupStats(week.filter((t) => t.kind === "recommended"));
  const wShadow = groupStats(week.filter((t) => t.kind === "shadow"));
  const all = card.performance.recommended;
  const ranked = card.signals.filter((s) => s.effect !== "base" && s.n >= 30);
  const best = ranked.slice(0, 5);
  const worst = [...ranked].reverse().slice(0, 5);

  const td = 'style="padding:5px 9px;border-bottom:1px solid #e5e7eb;font-size:13px"';
  const table = (head: string[], rows: string[][]) => `<table style="border-collapse:collapse;width:100%;margin:6px 0 14px"><thead><tr>${head.map((h) => `<th ${td} align="left">${h}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td ${td}>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  const sigRow = (s: (typeof ranked)[number]) => [esc(s.label), s.effect, String(s.n), pct(s.hitRate, 0), signed(s.avgNet), s.verdict];

  const html = `<div style="font-family:system-ui,Arial,sans-serif;max-width:760px">
<h2 style="margin:0 0 6px">Weekly scorecard — week to ${today}</h2>
<p style="font-size:14px">This week: <b>${wRec.closed}</b> recommended trades closed, win rate <b>${pct(wRec.winRate, 0)}</b>, net <b>${inr(wRec.netPnl)}</b>, profit factor ${wRec.profitFactor?.toFixed(2) ?? "—"}. Rejected (shadow) trades: ${inr(wShadow.netPnl)}.<br>
All time: ${all.closed} closed, win rate ${pct(all.winRate, 0)}, net ${inr(all.netPnl)}, expectancy ${all.expectancy != null ? inr(all.expectancy) : "—"} per trade.</p>
<h3 style="margin:10px 0 0">Agent vs simple baselines (open → close, after 0.1% costs)</h3>
${table(["Strategy", "Days", "Avg / day", "Compounded", "Winning days"], card.baselines.summary.map((b) => [esc(b.label), String(b.days), signed(b.avgNetPct), signed(b.cumPct), `${b.winDays}/${b.days}`]))}
<h3 style="margin:10px 0 0">Score calibration</h3>
<p style="font-size:13px;margin:4px 0">${esc(card.calibration.note)}</p>
${table(["Score", "Trades", "Win rate", "Avg return"], card.calibration.buckets.map((b) => [b.label, String(b.trades), pct(b.winRate, 0), signed(b.avgReturnPct)]))}
<h3 style="margin:10px 0 0">Best NSE signals (next-session hit rate, ${card.signalDays} days scored)</h3>
${table(["Signal", "Side", "Times", "Right", "Avg after costs", "Verdict"], best.map(sigRow))}
<h3 style="margin:10px 0 0">Weakest signals</h3>
${table(["Signal", "Side", "Times", "Right", "Avg after costs", "Verdict"], worst.map(sigRow))}
<h3 style="margin:10px 0 0">Specialist agents (right on closed trades)</h3>
${table(["Agent", "Calls", "Right", "Weight now"], card.accuracy.map((a) => [esc(a.label), String(a.calls), pct(a.accuracy, 0), String(card.weights.current.weights[a.agent] ?? "—")]))}
<h3 style="margin:10px 0 0">Self-review — what the evidence suggests</h3>
<ul style="font-size:13px">${card.suggestions.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
<p style="font-size:12px;color:#6b7280">Simulated trades only — no orders were placed. Not investment advice.</p></div>`;
  const text = [`Weekly scorecard — ${today}`, `Week: ${wRec.closed} closed, win ${pct(wRec.winRate, 0)}, ${inr(wRec.netPnl)}`, ...card.baselines.summary.map((b) => `${b.label}: ${signed(b.avgNetPct)}/day over ${b.days} days`), "", ...card.suggestions].join("\n");

  const res = await sendHtmlEmail(`[Weekly scorecard] ${today} — ${inr(wRec.netPnl)} this week, win rate ${pct(wRec.winRate, 0)}`, html, text);
  void notify.text(`🗓 <b>Weekly scorecard</b>\nWeek: ${wRec.closed} closed, win ${pct(wRec.winRate, 0)}, ${inr(wRec.netPnl)}\n${card.suggestions.slice(0, 3).map(esc).join("\n")}`).catch(() => undefined);
  return { sent: res.success, detail: res.success ? "sent" : `failed: ${res.error}` };
}
