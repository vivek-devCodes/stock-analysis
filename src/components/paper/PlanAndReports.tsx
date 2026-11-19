"use client";

import { CalendarClock, ClipboardCheck, Loader2, Moon, RefreshCw } from "lucide-react";
import { useState } from "react";
import { clsx } from "@/lib/format";
import type { DailyReport, PlanExecution, ReportGroup, SessionPlan } from "@/lib/paper/types";
import { Card } from "../shell/PageHeader";

const inr = (x: number | null | undefined) =>
  x == null || !Number.isFinite(x) ? "—" : `${x > 0 ? "+" : x < 0 ? "−" : ""}₹${Math.abs(x).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const px = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? "—" : x.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const short = (s: string) => s.replace(/\.(NS|BO)$/, "");
const dayLabel = (d: string) => new Date(`${d}T00:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" });
const EFFECT: Record<string, string> = { bullish: "text-up", bearish: "text-down", risk: "text-warn", info: "text-muted" };
const STATUS: Record<SessionPlan["status"], string> = {
  pending: "bg-accent/15 text-accent",
  executing: "bg-warn/15 text-warn",
  executed: "bg-up/15 text-up",
  expired: "bg-white/8 text-muted",
};

function Execution({ ex }: { ex: PlanExecution }) {
  return (
    <div className="mt-3 rounded-lg border border-line p-2.5 text-xs">
      <p className="font-semibold">{ex.rows.some((r) => r.final === false) ? `Executing at the ${dayLabel(ex.day)} open — waiting for opening-range breakouts (until 11:00)` : `Executed at the ${dayLabel(ex.day)} open (opening-range breakout entries)`}</p>
      <ul className="mt-1 space-y-0.5">
        {ex.rows.map((r) => (
          <li key={r.symbol} className={r.entered ? "text-up" : r.final === false ? "text-warn" : "text-muted"}>
            {r.entered ? "✓" : r.final === false ? "…" : "–"} <span className="font-medium text-foreground">{short(r.symbol)}</span> {r.reason}
            {r.range && <span className="text-muted"> · range {r.range.low.toFixed(2)}–{r.range.high.toFixed(2)}</span>}
          </li>
        ))}
      </ul>
      {ex.risk && ex.risk.length > 0 && <p className="mt-1 text-[11px] text-warn">Risk: {ex.risk.join(" · ")}</p>}
    </div>
  );
}

function GroupLine({ label, g }: { label: string; g: ReportGroup }) {
  if (!g.trades) return null;
  return (
    <span className="whitespace-nowrap">
      {label}: <span className={clsx("font-mono font-semibold", g.netPnl > 0 ? "text-up" : g.netPnl < 0 ? "text-down" : "")}>{inr(g.netPnl)}</span>{" "}
      <span className="text-muted">
        ({g.wins}/{g.closed} right{g.trades > g.closed ? `, ${g.trades - g.closed} open` : ""})
      </span>
    </span>
  );
}

export function PlanAndReports({ plan, reports, phase, onChanged }: { plan: SessionPlan | null; reports: DailyReport[]; phase: string; onChanged: () => void }) {
  const [busy, setBusy] = useState<null | "plan" | "report">(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(reports[0]?.day ?? null);
  const inSession = phase === "open" || phase === "warm-up" || phase === "no-new-entries";

  async function act(action: "plan" | "report") {
    setBusy(action);
    setMsg(null);
    try {
      const res = await fetch("/api/paper", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? `${action} failed`);
      setMsg(action === "plan" ? `Plan built: ${(j as SessionPlan).items.length} idea(s).` : "Report updated.");
      onChanged();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card
        icon={Moon}
        tone="text-accent"
        title={plan ? `Next-session plan · made after the ${dayLabel(plan.madeOn)} close` : "Next-session plan"}
        action={
          <button type="button" disabled={busy != null || inSession} onClick={() => void act("plan")} title={inSession ? "Plans are built after the close" : "Build tomorrow's plan now"} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs text-muted hover:bg-white/5 disabled:opacity-40">
            {busy === "plan" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} {busy === "plan" ? "Analysing… (1–3 min)" : "Build now"}
          </button>
        }
      >
        <p className="text-xs text-muted">
          Every weekday after the close (19:15 IST, retried at 21:00) the agent downloads the day&apos;s NSE files, screens every intraday setup, removes restricted stocks, re-ranks with delivery, F&amp;O and deal data, and runs the full
          multi-agent analysis. At the next open its first task is to enter these trades — unless the open gaps through the stop or target.
        </p>
        {msg && <p className="mt-2 text-xs text-warn">{msg}</p>}
        {!plan ? (
          <p className="mt-3 text-sm text-muted">No plan yet. The first one is built tonight after the close.</p>
        ) : (
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className={clsx("rounded-md px-1.5 py-0.5 font-bold uppercase", STATUS[plan.status])}>{plan.status}</span>
              <span className="text-muted">
                NSE files {plan.exchangeDate ?? "—"} · {plan.screened} screened · {plan.items.length} planned · {plan.skipped.length} filtered out
              </span>
            </div>
            {plan.marketNote && <p className="text-xs text-muted">Market: {plan.marketNote}</p>}
            {plan.items.length === 0 && <p className="text-sm text-muted">No setup survived the checks — the plan is to stay flat.</p>}
            <ul className="space-y-2">
              {plan.items.map((i) => (
                <li key={i.symbol} className="rounded-lg bg-white/3 p-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold">
                      {short(i.symbol)}{" "}
                      <span className={clsx("ml-1 rounded px-1.5 py-0.5 text-[10px] font-bold", i.side === "long" ? "bg-up/15 text-up" : "bg-down/15 text-down")}>{i.side === "long" ? "BUY" : "SELL"}</span>{" "}
                      <span className="text-[10px] font-normal text-muted">
                        {i.decision} · {i.validation}
                        {i.kind === "shadow" ? " · shadow (measuring the rejection)" : ""}
                      </span>
                    </p>
                    <p className="font-mono text-[11px] text-muted">
                      ref {px(i.refPrice)} · stop <span className="text-down">{px(i.stop)}</span> · target <span className="text-up">{px(i.target)}</span>
                      {i.riskReward ? ` · R:R ${i.riskReward.toFixed(1)}` : ""}
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-foreground/80">{i.reasons[0]}</p>
                  {i.exchange.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {i.exchange.map((e) => (
                        <span key={e.label} className={clsx("rounded bg-white/5 px-1.5 py-0.5 text-[10px]", EFFECT[e.effect] ?? "text-muted")} title={e.source}>
                          {e.label}: {e.value}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {plan.skipped.length > 0 && (
              <details className="text-xs text-muted">
                <summary className="cursor-pointer">Filtered out ({plan.skipped.length})</summary>
                <ul className="mt-1 space-y-0.5">
                  {plan.skipped.map((s) => (
                    <li key={s.symbol}>
                      {short(s.symbol)} — {s.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {plan.errors.length > 0 && <p className="text-[11px] text-warn">{plan.errors.join(" · ")}</p>}
            {plan.execution && <Execution ex={plan.execution} />}
          </div>
        )}
      </Card>

      <Card
        icon={ClipboardCheck}
        tone="text-up"
        title="Daily reports — was the agent right?"
        action={
          <button type="button" disabled={busy != null} onClick={() => void act("report")} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs text-muted hover:bg-white/5 disabled:opacity-40">
            {busy === "report" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarClock className="h-3.5 w-3.5" />} Today&apos;s report
          </button>
        }
      >
        <p className="text-xs text-muted">Built automatically after the close and emailed (when email is configured). A call is right when the trade closed with a net profit after costs.</p>
        {reports.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No reports yet — the first appears after the first trading day with paper trades.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {reports.map((r) => (
              <li key={r.day} className="rounded-lg border border-line">
                <button type="button" onClick={() => setOpen(open === r.day ? null : r.day)} className="w-full p-2.5 text-left">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{dayLabel(r.day)}</p>
                    <p className="flex flex-wrap gap-x-3 text-xs">
                      <GroupLine label="Plan" g={r.plan} />
                      <GroupLine label="Live" g={r.live} />
                      <GroupLine label="Shadow" g={r.shadow} />
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-muted">{r.headline}</p>
                </button>
                {open === r.day && (
                  <div className="overflow-x-auto border-t border-line p-2.5">
                    <table className="w-full min-w-[520px] text-xs">
                      <thead className="text-left text-muted">
                        <tr>
                          {["From", "Stock", "Call", "Entry", "Exit", "Result", "Net", "Right?"].map((h) => (
                            <th key={h} className="pb-1 font-normal">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {r.rows.map((x) => (
                          <tr key={x.symbol + x.origin} className="border-t border-line/50">
                            <td className="py-1 text-muted">{x.origin}</td>
                            <td className="py-1 font-medium">
                              {short(x.symbol)}
                              {x.kind === "shadow" && <span className="text-muted"> (shadow)</span>}
                            </td>
                            <td className="py-1">
                              {x.side === "long" ? "BUY" : "SELL"} · {x.decision}
                            </td>
                            <td className="py-1 font-mono">{px(x.entry)}</td>
                            <td className="py-1 font-mono">{px(x.exitPrice)}</td>
                            <td className="py-1">{x.status}</td>
                            <td className={clsx("py-1 font-mono", (x.netPnl ?? 0) > 0 ? "text-up" : (x.netPnl ?? 0) < 0 ? "text-down" : "")}>{inr(x.netPnl)}</td>
                            <td className="py-1">{x.correct == null ? "—" : x.correct ? "✔" : "✘"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {r.planSkipped.length > 0 && (
                      <p className="mt-2 text-[11px] text-muted">
                        Skipped at the open: {r.planSkipped.map((s) => `${short(s.symbol)} (${s.reason})`).join("; ")}
                      </p>
                    )}
                    {r.emailed && <p className="mt-1 text-[10px] text-muted">Email: {r.emailed}</p>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
