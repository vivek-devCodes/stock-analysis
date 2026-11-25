import "server-only";
import { buildInsight } from "../analysis";
import { computeIndicators } from "../indicators";
import { fetchChart, fetchIndexQuotes } from "../yahoo";
import { mapLimit, type ScanItem, type ScanRun } from "../agents/scan";
import { latestPlan, listDailyReports } from "../paper/plan-store";
import type { PlanItem } from "../paper/types";
import { getServerWatchlist } from "../watchlist-store";
import type { Recommendation } from "../types";
import type { ImproveState } from "../learn/improve";
import { describeExit } from "../learn/improve";
import { getLearned } from "../learn/store";
import { latestScreen } from "../insider/run";
import { VERDICT_TEXT } from "../insider/core";
import { currentCompass, recordCompass } from "../compass/fetch";
import type { Compass } from "../compass/core";

/**
 * The 08:30 IST morning report: market snapshot, today's trade plan, the agents' fresh calls and
 * every watchlist stock — all from the app's own rules. No external AI service is involved.
 */

export type WatchRow = {
  symbol: string;
  name: string;
  currency: string;
  price: number | null;
  changePct: number | null;
  signal: Recommendation | null;
  score: number | null;
  rsi: number | null;
  trend: string;
  support: number | null;
  resistance: number | null;
  note: string;
  error?: string;
};

export type MorningData = {
  day: string;
  generatedAt: string;
  indices: Array<{ name: string; price: number; changePercent: number }>;
  regime: string | null;
  plan: { madeOn: string; note: string; items: PlanItem[] } | null;
  calls: ScanItem[];
  watchlist: WatchRow[];
  watchlistSource: string;
  yesterday: string | null;
  learned: { changes: string[]; lessons: string[]; defensive: boolean; rules: string[]; setups: string[] } | null;
  insider: Array<{ symbol: string; net: number; buyers: number; promoter: boolean; verdict: string; reasons: string }>;
  compass: Compass | null;
  issues: string[];
};

const INDICES: Array<[string, string]> = [["^NSEI", "NIFTY 50"], ["^BSESN", "SENSEX"], ["^NSEBANK", "BANK NIFTY"], ["^INDIAVIX", "INDIA VIX"]];

export const istDay = (d = new Date()) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);

async function watchRow(symbol: string, calls: Map<string, ScanItem>): Promise<WatchRow> {
  const empty: WatchRow = { symbol, name: symbol, currency: "INR", price: null, changePct: null, signal: null, score: null, rsi: null, trend: "—", support: null, resistance: null, note: "" };
  try {
    const { quote, candles } = await fetchChart(symbol, "1y", "1d");
    if (candles.length < 30) return { ...empty, name: quote.name, price: quote.price, changePct: quote.changePercent, error: `only ${candles.length} days of history` };
    const ind = computeIndicators(candles);
    const insight = buildInsight(quote, candles, ind, []);
    const p = quote.price;
    const trend =
      ind.sma50 != null && ind.sma200 != null
        ? p > ind.sma50 && ind.sma50 > ind.sma200 ? "Uptrend" : p < ind.sma50 && ind.sma50 < ind.sma200 ? "Downtrend" : "Sideways"
        : ind.sma50 != null ? (p > ind.sma50 ? "Above 50-DMA" : "Below 50-DMA") : "—";
    const call = calls.get(symbol);
    const below = insight.support.filter((v) => v < p).sort((a, b) => b - a)[0] ?? null;
    const above = insight.resistance.filter((v) => v > p).sort((a, b) => a - b)[0] ?? null;
    return {
      symbol,
      name: quote.name,
      currency: quote.currency,
      price: p,
      changePct: quote.changePercent,
      signal: insight.recommendation,
      score: Math.round(insight.score),
      rsi: ind.rsi,
      trend,
      support: below,
      resistance: above,
      note: call ? `Agent: ${call.decision} (${call.validation})` : insight.headline,
    };
  } catch (error) {
    return { ...empty, error: error instanceof Error ? error.message : "data unavailable" };
  }
}

/** Gather everything the report shows. `run` is this morning's pre-market agent scan (may be null). */
export async function collectMorningData(run: ScanRun | null): Promise<MorningData> {
  const day = istDay();
  const issues: string[] = [];
  const calls = (run?.horizons ?? []).flatMap((h) => h.items).filter((i) => i.validation === "APPROVED" || i.validation === "APPROVED WITH CONDITIONS");
  const callMap = new Map((run?.horizons ?? []).flatMap((h) => h.items).map((i) => [i.symbol, i] as const));

  const [indexQuotes, plan, reports, wl, improve, insiderScreen, compassNow] = await Promise.all([
    fetchIndexQuotes(INDICES.map(([s]) => s)).catch(() => []),
    latestPlan().catch(() => null),
    listDailyReports(1).catch(() => []),
    getServerWatchlist(),
    getLearned<ImproveState>("improve").catch(() => null),
    latestScreen().catch(() => null),
    currentCompass(true).catch(() => null),
  ]);
  if (compassNow) await recordCompass(compassNow.compass).catch(() => undefined);
  const imp = improve?.data ?? null;
  const watchlist = await mapLimit(wl.symbols, 4, (s) => watchRow(s, callMap));
  for (const w of watchlist) if (w.error) issues.push(`${w.symbol}: ${w.error}`);

  // Today's plan is the one built after the previous session (made before today, not yet expired).
  const todays = plan && plan.madeOn < day && plan.status !== "expired" ? plan : null;
  const indices = INDICES.map(([sym, name]) => {
    const q = indexQuotes.find((x) => x.symbol === sym);
    return q ? { name, price: q.price, changePercent: q.changePercent } : null;
  }).filter((x): x is NonNullable<typeof x> => x !== null);
  if (indices.length < INDICES.length) issues.push("Some index quotes were unavailable.");
  if (run?.errors.length) issues.push(...run.errors.slice(0, 3));

  return {
    day,
    generatedAt: new Date().toISOString(),
    indices,
    regime: run ? run.marketRegime : null,
    plan: todays ? { madeOn: todays.madeOn, note: todays.marketNote, items: todays.items } : null,
    calls,
    watchlist,
    watchlistSource: wl.source,
    yesterday: reports[0] ? `${reports[0].day}: ${reports[0].headline}` : null,
    compass: compassNow?.compass ?? null,
    insider: (insiderScreen?.buying ?? [])
      .filter((p) => p.chart.verdict !== "avoid")
      .slice(0, 8)
      .map((p) => ({ symbol: p.symbol, net: p.netValue, buyers: p.buyers, promoter: p.promoterBuy, verdict: VERDICT_TEXT[p.chart.verdict], reasons: p.chart.reasons.slice(0, 2).join(" · ") })),
    learned: imp
      ? {
          changes: imp.changes,
          lessons: imp.lessons.slice(0, 5),
          defensive: imp.defensive,
          rules: [
            `Exits: ${describeExit(imp.tuning)}`,
            `Opening range: ${imp.tuning.orbMinutes} min`,
            `Market-direction filter: ${imp.tuning.marketAlign ? "on" : "off"}`,
            `Minimum score: ${imp.tuning.minScore ?? "none"}`,
          ],
          setups: imp.setups.filter((s) => s.status === "proven" || s.status === "blocked").map((s) => `${s.status === "proven" ? "Proven" : "Blocked"}: ${s.label} (${s.n} trades, avg ${s.avgR >= 0 ? "+" : ""}${s.avgR.toFixed(2)}R)`),
        }
      : null,
    issues,
  };
}

/* ------------------------------------------------ render ------------------------------------------------ */

const C = { bg: "#f4f6fa", card: "#ffffff", line: "#e3e7ef", text: "#18202c", muted: "#6b7587", up: "#0f9d58", down: "#d93025", warn: "#b7791f", accent: "#2f6fed", head: "#0f1d33" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const num = (x: number | null | undefined, d = 2) => (x == null || !Number.isFinite(x) ? "—" : x.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }));
const money = (x: number | null, currency = "INR") => (x == null ? "—" : `${currency === "INR" ? "₹" : currency === "USD" ? "$" : ""}${num(x)}`);
const pct = (x: number | null) => (x == null ? "—" : `${x >= 0 ? "+" : ""}${x.toFixed(2)}%`);
const tone = (x: number | null) => (x == null ? C.muted : x >= 0 ? C.up : C.down);
const sigColor = (s: string | null) => (s === "BUY" ? C.up : s === "SELL" ? C.down : C.warn);
const short = (s: string) => s.replace(/\.(NS|BO)$/, "");
const longDate = (day: string) => new Date(`${day}T00:00:00+05:30`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });

const th = (label: string, align = "left") => `<th style="padding:8px 10px;text-align:${align};font-size:11px;font-weight:600;color:${C.muted};text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid ${C.line}">${label}</th>`;
const td = (html: string, align = "left", extra = "") => `<td style="padding:9px 10px;text-align:${align};border-bottom:1px solid ${C.line};font-size:13px;vertical-align:top;${extra}">${html}</td>`;
const section = (title: string, sub: string, body: string) => `
  <div style="background:${C.card};border:1px solid ${C.line};border-radius:12px;margin:16px 0;overflow:hidden">
    <div style="padding:14px 16px 10px"><div style="font-size:15px;font-weight:700;color:${C.text}">${title}</div>${sub ? `<div style="font-size:12px;color:${C.muted};margin-top:2px">${sub}</div>` : ""}</div>
    ${body}
  </div>`;
const table = (head: string, rows: string) => `<div style="overflow-x:auto"><table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse">${`<tr>${head}</tr>`}${rows}</table></div>`;
const emptyNote = (text: string) => `<div style="padding:4px 16px 16px;font-size:13px;color:${C.muted}">${text}</div>`;

export function renderMorningReport(d: MorningData): { subject: string; html: string; text: string } {
  const buys = d.watchlist.filter((w) => w.signal === "BUY").length;
  const sells = d.watchlist.filter((w) => w.signal === "SELL").length;
  const planCount = d.plan?.items.length ?? 0;
  const subject = `Morning Report · ${longDate(d.day)} · ${planCount} plan trade${planCount === 1 ? "" : "s"} · ${d.calls.length} agent call${d.calls.length === 1 ? "" : "s"} · watchlist ${buys} buy / ${sells} sell`;

  const tiles = d.indices
    .map((i) => `<td style="padding:6px;width:25%"><div style="background:${C.card};border:1px solid ${C.line};border-radius:10px;padding:10px 12px">
        <div style="font-size:11px;color:${C.muted};font-weight:600">${esc(i.name)}</div>
        <div style="font-size:17px;font-weight:700;margin-top:2px">${num(i.price)}</div>
        <div style="font-size:12px;font-weight:600;color:${i.name === "INDIA VIX" ? (i.changePercent > 0 ? C.down : C.up) : tone(i.changePercent)}">${pct(i.changePercent)}</div></div></td>`)
    .join("");

  const planRows = (d.plan?.items ?? [])
    .map((p) => `<tr>
      ${td(`<b>${esc(short(p.symbol))}</b><div style="font-size:11px;color:${C.muted}">${esc(p.name)}</div>`)}
      ${td(`<b style="color:${p.side === "long" ? C.up : C.down}">${p.side === "long" ? "BUY" : "SELL"}</b>`)}
      ${td(`${num(p.entryLow)} – ${num(p.entryHigh)}<div style="font-size:11px;color:${C.muted}">${esc(p.trigger)}</div>`)}
      ${td(num(p.stop), "right", `color:${C.down}`)}
      ${td(num(p.target), "right", `color:${C.up}`)}
      ${td(p.riskReward ? p.riskReward.toFixed(1) : "—", "right")}
      ${td(esc(p.reasons.slice(0, 2).join(" · ") || "—"), "left", "font-size:12px")}
    </tr>`)
    .join("");

  const callRows = d.calls
    .map((c) => `<tr>
      ${td(`<b>${esc(short(c.symbol))}</b><div style="font-size:11px;color:${C.muted}">${esc(c.horizon)}</div>`)}
      ${td(`<b style="color:${sigColor(c.decision)}">${esc(c.decision)}</b><div style="font-size:11px;color:${C.muted}">${esc(c.validation)} · score ${c.score ?? "—"}</div>`)}
      ${td(c.plan ? `${num(c.plan.entryLow)} – ${num(c.plan.entryHigh)}` : "—")}
      ${td(c.plan ? num(c.plan.stop) : "—", "right", `color:${C.down}`)}
      ${td(c.plan ? num(c.plan.target1) : "—", "right", `color:${C.up}`)}
      ${td(esc(c.evidence.probabilityType === "backtested" ? `Backtested hit rate ${Math.round((c.evidence.hitRate ?? 0) * 100)}% (${c.evidence.samples} signals)` : "No backtest yet"), "left", "font-size:12px")}
    </tr>`)
    .join("");

  const watchRows = d.watchlist
    .map((w) => `<tr>
      ${td(`<b>${esc(short(w.symbol))}</b><div style="font-size:11px;color:${C.muted}">${esc(w.name)}</div>`)}
      ${td(money(w.price, w.currency), "right")}
      ${td(pct(w.changePct), "right", `color:${tone(w.changePct)};font-weight:600`)}
      ${td(w.signal ? `<b style="color:${sigColor(w.signal)}">${w.signal}</b><div style="font-size:11px;color:${C.muted}">score ${w.score ?? "—"}</div>` : "—", "left", "white-space:nowrap")}
      ${td(w.rsi == null ? "—" : w.rsi.toFixed(0), "right")}
      ${td(esc(w.trend), "left", "white-space:nowrap")}
      ${td(`<span style="color:${C.up}">S ${num(w.support)}</span><br><span style="color:${C.down}">R ${num(w.resistance)}</span>`, "right", "white-space:nowrap")}
      ${td(esc(w.error ? `Data unavailable: ${w.error}` : w.note), "left", "font-size:12px")}
    </tr>`)
    .join("");

  const html = `<!doctype html><html><body style="margin:0;background:${C.bg}">
  <div style="max-width:880px;margin:0 auto;padding:20px 12px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${C.text}">
    <div style="background:${C.head};color:#fff;border-radius:14px;padding:20px 20px 16px">
      <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.7">Apex Desk · Morning Report</div>
      <div style="font-size:22px;font-weight:700;margin-top:4px">${esc(longDate(d.day))}</div>
      <div style="font-size:13px;opacity:.8;margin-top:4px">Prepared before the 09:15 IST open${d.regime ? ` · Market regime: ${esc(d.regime)}` : ""}</div>
    </div>

    ${d.indices.length ? `<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;margin-top:10px"><tr>${tiles}</tr></table>` : ""}

    ${d.compass ? section(`Market Compass: ${esc(d.compass.biasText)}${d.compass.score != null ? ` (${d.compass.score > 0 ? "+" : ""}${d.compass.score})` : ""}`, `${d.compass.expectedGapPct != null ? `GIFT Nifty points to ${d.compass.expectedGapPct >= 0 ? "+" : ""}${d.compass.expectedGapPct.toFixed(2)}% at the open. ` : ""}${esc(d.compass.volatilityText)}.`,
      table(th("Check") + th("Reading") + th("Says"), d.compass.checks.map((c) => `<tr>
        ${td(esc(c.label))}
        ${td(esc(c.reading), "left", "font-size:12px")}
        ${td(`<b style="color:${c.tone === "bullish" ? C.up : c.tone === "bearish" ? C.down : C.muted}">${c.tone === "bullish" ? "Positive" : c.tone === "bearish" ? "Negative" : c.tone === "neutral" ? "Neutral" : "—"}</b>`)}
      </tr>`).join("")) + (d.compass.playbook.length ? `<div style="padding:10px 16px 14px;font-size:13px">${d.compass.playbook.map((p) => `<div>• ${esc(p)}</div>`).join("")}</div>` : "")) : ""}

    ${section("Today's trade plan", d.plan ? `Built from NSE end-of-day data after ${esc(d.plan.madeOn)}. ${esc(d.plan.note)}` : "",
      planRows ? table(th("Stock") + th("Side") + th("Entry zone") + th("Stop", "right") + th("Target", "right") + th("R:R", "right") + th("Why"), planRows) : emptyNote("No intraday plan for today: nothing passed the plan's evidence and risk rules (or the nightly NSE data was not available)."))}

    ${section("Fresh recommendations from the AI Analyst", "This morning's pre-market scan. Only approved calls are listed.",
      callRows ? table(th("Stock") + th("Call") + th("Entry") + th("Stop", "right") + th("Target", "right") + th("Evidence"), callRows) : emptyNote("No approved calls this morning. No trade is a valid outcome when nothing meets the rules."))}

    ${section(`Your watchlist (${d.watchlist.length})`, "Last close, the rule-based signal, trend and the nearest support / resistance.",
      watchRows ? table(th("Stock") + th("Last", "right") + th("Day", "right") + th("Signal") + th("RSI", "right") + th("Trend") + th("Levels", "right") + th("Note"), watchRows) : emptyNote("Your watchlist is empty. Add stocks on the Stock Analyzer page."))}

    ${section("Insider buying this week", "Promoters / directors buying in the open market (NSE disclosures), checked on the daily chart.",
      d.insider.length
        ? table(th("Stock") + th("Net bought", "right") + th("Insiders", "right") + th("Chart") + th("Why"), d.insider.map((x) => `<tr>
          ${td(`<b>${esc(x.symbol)}</b>${x.promoter ? `<div style="font-size:11px;color:${C.accent}">Promoter buying</div>` : ""}`)}
          ${td(x.net >= 1e7 ? `₹${(x.net / 1e7).toFixed(2)} cr` : `₹${(x.net / 1e5).toFixed(1)} L`, "right", `color:${C.up};font-weight:600`)}
          ${td(String(x.buyers), "right")}
          ${td(`<b style="color:${x.verdict === "Setup ready" ? C.up : C.warn}">${esc(x.verdict)}</b>`)}
          ${td(esc(x.reasons), "left", "font-size:12px")}
        </tr>`).join(""))
        : emptyNote("No promoter or director open-market buying in the last 7 days, or the screen has not run yet."))}

    ${d.yesterday ? section("Yesterday's paper trading", "", `<div style="padding:0 16px 14px;font-size:13px">${esc(d.yesterday)}</div>`) : ""}

    ${d.learned ? section("What the engine learned", d.learned.defensive ? `<b style="color:${C.down}">Defensive mode: only proven setups are traded until results recover.</b>` : "From last night's post-mortem of every closed paper trade.",
      `<div style="padding:0 16px 14px;font-size:13px;line-height:1.55">
        ${d.learned.changes.length ? `<div style="font-weight:600;color:${C.accent};margin-bottom:4px">Changed</div>${d.learned.changes.map((c) => `<div>• ${esc(c)}</div>`).join("")}` : ""}
        <div style="font-weight:600;margin:8px 0 4px">Lessons</div>${d.learned.lessons.map((l) => `<div>• ${esc(l)}</div>`).join("")}
        ${d.learned.setups.length ? `<div style="font-weight:600;margin:8px 0 4px">Setups</div>${d.learned.setups.map((s) => `<div>• ${esc(s)}</div>`).join("")}` : ""}
        <div style="color:${C.muted};font-size:12px;margin-top:8px">Trading with: ${esc(d.learned.rules.join(" · "))}</div>
      </div>`) : ""}

    ${d.issues.length ? `<div style="font-size:11px;color:${C.warn};margin:8px 4px">Data notes: ${esc(d.issues.slice(0, 6).join(" | "))}</div>` : ""}
    <div style="font-size:11px;color:${C.muted};margin:14px 4px;line-height:1.5">
      Generated by Apex Desk's own rules from NSE/BSE and Yahoo Finance data. No external AI service is used.
      Research output, not personalised investment advice; Apex Desk is not a SEBI-registered adviser. No orders are placed.
      Signals: BUY/SELL/HOLD from the technical scoring engine; trend uses the 50- and 200-day moving averages.
    </div>
  </div></body></html>`;

  const text = [
    subject,
    "",
    "MARKET: " + d.indices.map((i) => `${i.name} ${num(i.price)} (${pct(i.changePercent)})`).join(" | "),
    d.regime ? `Regime: ${d.regime}` : "",
    "",
    "TODAY'S TRADE PLAN",
    ...(d.plan?.items.length ? d.plan.items.map((p) => `- ${short(p.symbol)} ${p.side === "long" ? "BUY" : "SELL"} ${num(p.entryLow)}-${num(p.entryHigh)} stop ${num(p.stop)} target ${num(p.target)}`) : ["- No plan for today"]),
    "",
    "AI ANALYST CALLS",
    ...(d.calls.length ? d.calls.map((c) => `- ${short(c.symbol)} (${c.horizon}) ${c.decision} ${c.plan ? `entry ${num(c.plan.entryLow)}-${num(c.plan.entryHigh)} stop ${num(c.plan.stop)} T1 ${num(c.plan.target1)}` : ""}`) : ["- No approved calls"]),
    "",
    "WATCHLIST",
    ...d.watchlist.map((w) => `- ${short(w.symbol)} ${money(w.price, w.currency)} ${pct(w.changePct)} ${w.signal ?? "—"} RSI ${w.rsi?.toFixed(0) ?? "—"} ${w.trend} S/R ${num(w.support)}/${num(w.resistance)}`),
    d.yesterday ? `\nYesterday: ${d.yesterday}` : "",
    d.learned ? ["", "WHAT THE ENGINE LEARNED", ...d.learned.changes.map((c) => `- Changed: ${c}`), ...d.learned.lessons.map((l) => `- ${l}`)].join("\n") : "",
    "",
    "Research output, not investment advice. No external AI service is used.",
  ].join("\n");

  return { subject, html, text };
}
