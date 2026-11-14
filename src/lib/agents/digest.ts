import "server-only";
import calibration from "../calibration.json";
import type { ScanItem, ScanRun } from "./scan";
import { describeRules } from "./thresholds";

/**
 * Scan digest email: what the agent analysed, what it decided, why, and whether there is
 * evidence of profitability — plus every rule and threshold it applied.
 */

const C = { bg: "#0f1419", card: "#1a1f26", line: "#2a3140", text: "#e8edf4", muted: "#8b95a5", up: "#3dd68c", down: "#ff5c7a", warn: "#f5c542", accent: "#5b8cff" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const f = (x: number) => x.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const pct = (x: number | null, d = 1) => (x == null ? "—" : `${(x * 100).toFixed(d)}%`);
const SESSION_TITLE = { premarket: "Pre-market plan", intraday: "Intraday scan", postmarket: "After-market review & next-session plan" } as const;
const HORIZON_TITLE = { intraday: "Intraday", swing: "Swing / short term", "long-term": "Long term" } as const;

function verdictColor(v: ScanItem["validation"]) {
  return v === "APPROVED" ? C.up : v === "APPROVED WITH CONDITIONS" ? C.warn : C.muted;
}

function itemRow(i: ScanItem): string {
  const plan = i.plan
    ? `${i.plan.direction === "long" ? "Buy" : "Sell"} ${f(i.plan.entryLow)}–${f(i.plan.entryHigh)} · stop ${f(i.plan.stop)} · T1 ${f(i.plan.target1)}${i.plan.riskReward ? ` · R:R ${i.plan.riskReward.toFixed(1)}` : ""}${i.plan.illustrative ? " · qty illustrative" : ` · qty ${i.plan.quantity}`}`
    : "No trade plan";
  const evidence =
    i.evidence.probabilityType === "backtested"
      ? `Backtested: right ${pct(i.evidence.hitRate, 0)} of the time, ${pct(i.evidence.expectancyPct, 2)} per trade after costs (${i.evidence.samples.toLocaleString("en-IN")} signals)`
      : "Profitability: UNKNOWN — no validated probability for this setup";
  return `<tr>
    <td style="padding:10px;border-bottom:1px solid ${C.line};vertical-align:top">
      <div style="font-weight:700">${esc(i.symbol.replace(/\.NS$/, ""))}</div>
      <div style="font-size:11px;color:${C.muted}">${esc(i.name)}</div>
    </td>
    <td style="padding:10px;border-bottom:1px solid ${C.line};vertical-align:top;white-space:nowrap">
      <div style="font-weight:700;color:${verdictColor(i.validation)}">${esc(i.decision)}</div>
      <div style="font-size:11px;color:${C.muted}">${esc(i.validation)} · score ${i.score ?? "—"}</div>
    </td>
    <td style="padding:10px;border-bottom:1px solid ${C.line};font-size:12px;vertical-align:top">
      <div>${esc(plan)}</div>
      <div style="color:${C.muted};margin-top:4px">${esc(evidence)}</div>
      ${i.reasons.map((r) => `<div style="margin-top:4px">• ${esc(r)}</div>`).join("")}
      ${i.failedChecks.length ? `<div style="margin-top:4px;color:${C.down}">Failed: ${esc(i.failedChecks.slice(0, 3).join(" | "))}</div>` : ""}
    </td>
  </tr>`;
}

export function buildDigest(run: ScanRun): { subject: string; html: string; text: string } {
  const date = new Date(run.startedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
  const { approved, watchlist } = run.counts;
  const subject = `[AGENT SCAN] ${SESSION_TITLE[run.session]} – ${date} – ${approved} approved, ${watchlist} watchlist${approved + watchlist === 0 ? " (NO TRADE)" : ""}`;
  const cal = calibration as unknown as { period: string; horizonDays: number; buy: { hitRate: number; expectancy: number; proven: boolean } | null; sell: { hitRate: number; expectancy: number; proven: boolean } | null };

  const sections = run.horizons
    .map(
      (h) => `<h3 style="margin:24px 0 6px;font-size:16px">${HORIZON_TITLE[h.horizon]}</h3>
      <p style="margin:0 0 8px;font-size:12px;color:${C.muted}">Screened ${h.screened} stocks → shortlisted ${h.shortlisted.length} (${esc(h.shortlisted.map((s) => s.replace(/\.NS$/, "")).join(", ") || "none")}) → full agent analysis below.</p>
      ${h.items.length ? `<table style="width:100%;border-collapse:collapse;background:${C.card};border:1px solid ${C.line};border-radius:8px">${h.items.map(itemRow).join("")}</table>` : `<p style="font-size:13px">No candidates passed the screen.</p>`}`,
    )
    .join("");

  const rules = describeRules()
    .map((g) => `<p style="margin:12px 0 4px;font-weight:700;font-size:13px">${esc(g.group)}</p><ul style="margin:0;padding-left:18px">${g.rules.map((r) => `<li style="margin:3px 0">${esc(r)}</li>`).join("")}</ul>`)
    .join("");

  const html = `<div style="background:${C.bg};color:${C.text};padding:20px;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">
    <h2 style="margin:0">${esc(SESSION_TITLE[run.session])} — ${esc(date)}</h2>
    <p style="margin:6px 0 0;color:${C.muted};font-size:13px">Market regime: ${esc(run.marketRegime)} · ${esc(run.note)}</p>
    <p style="margin:12px 0 0;font-size:15px"><b style="color:${C.up}">${approved} approved</b> · <b style="color:${C.warn}">${watchlist} watchlist</b> · ${run.counts.noTrade} no trade</p>
    ${approved + watchlist === 0 ? `<p style="margin:8px 0 0;padding:10px;border:1px solid ${C.line};border-radius:8px">NO TRADE – NO SUITABLE RISK-ADJUSTED OPPORTUNITY IDENTIFIED. This is a valid outcome: nothing met the evidence and risk rules below.</p>` : ""}
    ${sections}
    <h3 style="margin:28px 0 6px;font-size:16px">Is any of this proven profitable?</h3>
    <p style="font-size:13px;margin:0">Swing BUY setups: right ${pct(cal.buy?.hitRate ?? null, 0)} of the time, ${pct(cal.buy?.expectancy ?? null, 2)} per trade after costs — ${cal.buy?.proven ? "PROVEN" : "NOT proven"}. Swing SELL setups: ${pct(cal.sell?.hitRate ?? null, 0)}, ${pct(cal.sell?.expectancy ?? null, 2)} — ${cal.sell?.proven ? "PROVEN" : "NOT proven"}. (Out-of-sample ${esc(cal.period)}, ${cal.horizonDays}-day horizon.) Intraday and long-term rules have no validated backtest yet, so their probability is reported as unknown.</p>
    <h3 style="margin:28px 0 6px;font-size:16px">Rules and thresholds applied</h3>
    <div style="font-size:12px;color:${C.text}">${rules}</div>
    ${run.errors.length ? `<p style="margin-top:16px;font-size:11px;color:${C.warn}">Data issues: ${esc(run.errors.slice(0, 5).join(" | "))}</p>` : ""}
    <p style="margin-top:20px;font-size:11px;color:${C.muted}">Research output, not personalised investment advice; Apex Desk is not a SEBI-registered adviser. No orders are placed. Past/backtested results do not guarantee future returns. Prices may be 15-min delayed when NSE's live feed is unavailable.</p>
  </div>`;

  const text = [
    subject,
    `Market regime: ${run.marketRegime}. ${run.note}`,
    ...run.horizons.flatMap((h) => [
      "",
      `${HORIZON_TITLE[h.horizon]} — screened ${h.screened}, shortlisted ${h.shortlisted.length}`,
      ...h.items.map((i) => `- ${i.symbol}: ${i.decision} (${i.validation}, score ${i.score ?? "—"})${i.plan ? ` entry ${f(i.plan.entryLow)}–${f(i.plan.entryHigh)} stop ${f(i.plan.stop)} T1 ${f(i.plan.target1)}` : ""}${i.evidence.probabilityType === "unknown" ? " — profitability unknown" : ` — hit ${pct(i.evidence.hitRate, 0)}, ${pct(i.evidence.expectancyPct, 2)}/trade`}`),
    ]),
    "",
    "Rules applied:",
    ...describeRules().flatMap((g) => [`${g.group}:`, ...g.rules.map((r) => `  - ${r}`)]),
  ].join("\n");

  return { subject, html, text };
}
