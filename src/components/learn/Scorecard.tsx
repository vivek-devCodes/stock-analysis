"use client";

import { AlertTriangle, CheckCircle2, Gauge, Loader2, PauseCircle, PlayCircle, RefreshCw, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Health } from "@/lib/learn/health";
import type { Scorecard as Card$ } from "@/lib/learn/scorecard";
import { AGENT_LABELS, type AgentId } from "@/lib/agents/types";
import { clsx } from "@/lib/format";
import { Card, PageHeader } from "../shell/PageHeader";
import { SelfImprovement } from "./SelfImprovement";

type Payload = Card$ & { health: Health | null };

const pct = (x: number | null | undefined, d = 0) => (x == null ? "—" : `${(x * 100).toFixed(d)}%`);
const signed = (x: number | null | undefined, d = 2) => (x == null ? "—" : `${x >= 0 ? "+" : ""}${x.toFixed(d)}%`);
const inr = (x: number | null | undefined) => (x == null ? "—" : `${x >= 0 ? "+" : "−"}₹${Math.abs(Math.round(x)).toLocaleString("en-IN")}`);
const tone = (x: number | null | undefined) => (x == null ? "" : x > 0 ? "text-up" : x < 0 ? "text-down" : "");
const hitTone = (h: number | null, n: number) => (h == null || n < 30 ? "text-muted" : h >= 0.55 ? "text-up" : h < 0.5 ? "text-down" : "");

async function post(action: string) {
  const res = await fetch("/api/scorecard", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error ?? `${action} failed`);
  return j;
}

function Bar({ value, max = 1, className }: { value: number | null; max?: number; className?: string }) {
  const w = value == null ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="h-1.5 w-full rounded-full bg-white/5">
      <div className={clsx("h-1.5 rounded-full", className ?? "bg-accent")} style={{ width: `${w}%` }} />
    </div>
  );
}

export function Scorecard() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/scorecard", { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Could not load the scorecard");
      setData(j as Payload);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(id);
  }, [load]);

  async function act(action: string) {
    setBusy(action);
    try {
      await post(action);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const d = data;
  const g = d?.guard;
  const r = g?.regime;
  const base = d?.signals.find((s) => s.effect === "base");
  const sigs = d?.signals.filter((s) => s.effect !== "base") ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Gauge}
        tone="text-[#22d3ee]"
        title="Scorecard"
        subtitle="Which signals, agents and scores actually work — measured against what the market did next, compared with simple baselines, and fed back into the agent."
        actions={
          <button type="button" onClick={() => void act("learn")} disabled={busy != null} className="inline-flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm text-muted hover:bg-white/5 disabled:opacity-50">
            {busy === "learn" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Score new days now
          </button>
        }
      />
      {error && (
        <p className="flex items-center gap-2 text-sm text-down">
          <AlertTriangle className="h-4 w-4" /> {error}
        </p>
      )}
      {!d && !error && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      )}

      {d && (
        <>
          {/* Risk state and regime */}
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Market regime (today)">
              {r ? (
                <>
                  <p className={clsx("text-lg font-semibold capitalize", r.level === "calm" ? "text-up" : r.level === "caution" ? "text-warn" : "text-down")}>{r.level.replace("-", " ")}</p>
                  <p className="text-xs text-muted">
                    Size ×{r.sizeMult} · up to {r.maxNewTrades} open positions · {r.allowLong ? "longs" : ""}
                    {r.allowLong && r.allowShort ? " and " : ""}
                    {r.allowShort ? "shorts" : ""}
                    {!r.allowLong && !r.allowShort ? "no trades" : " allowed"}
                  </p>
                  <ul className="mt-2 space-y-1 text-xs">
                    {r.notes.map((n) => (
                      <li key={n}>· {n}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-xs text-muted">Regime unavailable.</p>
              )}
            </Card>
            <Card title="Risk rules">
              {g ? (
                <>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="text-muted">Drawdown</p>
                      <p className={clsx("font-mono text-base", g.drawdownPct >= d.thresholds.guard.drawdownPausePct ? "text-down" : "")}>{g.drawdownPct.toFixed(1)}%</p>
                      <Bar value={g.drawdownPct} max={d.thresholds.guard.drawdownPausePct} className={g.paused ? "bg-down" : "bg-warn"} />
                    </div>
                    <div>
                      <p className="text-muted">New trades allowed now</p>
                      <p className="font-mono text-base">{g.allowNew ? g.slots : 0}</p>
                    </div>
                  </div>
                  <ul className="mt-2 space-y-1 text-xs">
                    {g.reasons.length ? g.reasons.map((x) => <li key={x} className="text-warn">· {x}</li>) : <li className="text-up">· All clear — no limit reached.</li>}
                  </ul>
                  <p className="mt-2 text-[10px] text-muted">
                    Daily loss limit {d.thresholds.guard.dailyLossPct}% · max {d.thresholds.guard.maxOpen} open · {d.thresholds.guard.maxPerSector} per sector · ≤{d.thresholds.guard.maxPositionPct}% per position · pause at {d.thresholds.guard.drawdownPausePct}% drawdown · stop to entry at +{d.thresholds.guard.breakEvenR}R. Blocked trades are still paper-traded as shadow.
                  </p>
                  {g.paused && (
                    <button type="button" onClick={() => void act("resume")} disabled={busy != null} className="mt-2 inline-flex items-center gap-2 rounded-lg bg-accent/15 px-3 py-1.5 text-xs text-accent hover:bg-accent/25">
                      {busy === "resume" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />} Resume recommended trades
                    </button>
                  )}
                  {!g.paused && g.drawdownPct > 0 && (
                    <p className="mt-2 flex items-center gap-1 text-[10px] text-muted">
                      <PauseCircle className="h-3 w-3" /> Pauses automatically at {d.thresholds.guard.drawdownPausePct}%.
                    </p>
                  )}
                </>
              ) : (
                <p className="text-xs text-muted">Unavailable.</p>
              )}
            </Card>
            <Card title="Health check (last night)">
              {d.health ? (
                <>
                  <p className="text-[10px] text-muted">{new Date(d.health.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST</p>
                  <ul className="mt-1 space-y-1 text-xs">
                    {d.health.checks.map((c) => (
                      <li key={c.name} className="flex gap-1.5">
                        {c.status === "ok" ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-up" /> : c.status === "warn" ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-down" />}
                        <span>
                          <b className="font-medium">{c.name}:</b> {c.detail}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-xs text-muted">Runs every night after the close.</p>
              )}
              <button type="button" onClick={() => void act("health")} disabled={busy != null} className="mt-2 text-[11px] text-accent hover:underline">
                {busy === "health" ? "Checking…" : "Run the check now"}
              </button>
            </Card>
          </div>

          {/* Self-improvement engine */}
          <SelfImprovement state={d.improve} />

          {/* Self-review */}
          <Card title="Self-review — what the evidence says">
            <ul className="space-y-1.5 text-sm">
              {d.suggestions.map((s) => (
                <li key={s}>· {s}</li>
              ))}
            </ul>
            <p className="mt-2 text-[10px] text-muted">
              Signals are muted automatically once they have {d.thresholds.learn.minSignalObs} observations and are right less than {d.thresholds.learn.muteBelow * 100}% of the time; agent weights adapt (0.5×–1.5×) after {d.thresholds.learn.minTradesToAdapt} closed paper trades.
              {d.weights.adaptiveOff ? " Adaptive weights are switched OFF (ADAPTIVE_WEIGHTS=off)." : ""}
            </p>
          </Card>

          {/* Baselines */}
          <Card title="Is the agent adding value? Agent vs simple baselines">
            <p className="-mt-1 mb-2 text-[11px] text-muted">Each strategy is entered at the open and closed at the close of the same session, after 0.1% costs — a like-for-like test. The agent&apos;s real paper trades (with stops, targets and breakout entries) are on the Paper Trading page.</p>
            <table className="w-full text-xs">
              <thead className="text-left text-muted">
                <tr>
                  <th className="pb-1 font-normal">Strategy</th>
                  <th className="pb-1 text-right font-normal">Days</th>
                  <th className="pb-1 text-right font-normal">Avg / day</th>
                  <th className="pb-1 text-right font-normal">Compounded</th>
                  <th className="pb-1 text-right font-normal">Winning days</th>
                </tr>
              </thead>
              <tbody>
                {d.baselines.summary.map((b) => (
                  <tr key={b.key} className={clsx("border-t border-line/40", b.key === "agent" && "font-semibold")}>
                    <td className="py-1.5">{b.label}</td>
                    <td className="py-1.5 text-right font-mono">{b.days}</td>
                    <td className={clsx("py-1.5 text-right font-mono", tone(b.avgNetPct))}>{signed(b.avgNetPct)}</td>
                    <td className={clsx("py-1.5 text-right font-mono", tone(b.cumPct))}>{b.days ? signed(b.cumPct) : "—"}</td>
                    <td className="py-1.5 text-right font-mono">{b.days ? `${b.winDays}/${b.days}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {d.baselines.summary.every((b) => b.days === 0) && <p className="mt-2 text-xs text-muted">Starts with the first executed plan — one row per trading day.</p>}
          </Card>

          {/* Signals */}
          <Card title={`NSE signal scorecard — ${d.signalDays} session${d.signalDays === 1 ? "" : "s"} scored`}>
            <p className="-mt-1 mb-2 text-[11px] text-muted">
              Every liquid stock (≥ ₹{d.thresholds.learn.liquidCr} crore traded) is checked each night: did the signal&apos;s direction match the NEXT session&apos;s open → close move? Close → close (including the overnight gap) is shown too.
              {base?.hitRate != null && ` Base rate: ${pct(base.hitRate)} of ${base.n.toLocaleString("en-IN")} stock-days closed above their open. Signals are judged by their edge over that, so a falling market does not make every short signal look good.`}
            </p>
            {sigs.length === 0 ? (
              <p className="text-xs text-muted">No sessions scored yet — needs two consecutive days of stored NSE files (click “Score new days now”).</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-xs">
                  <thead className="text-left text-muted">
                    <tr>
                      <th className="pb-1 font-normal">Signal</th>
                      <th className="pb-1 font-normal">Side</th>
                      <th className="pb-1 text-right font-normal">Times</th>
                      <th className="w-32 pb-1 text-right font-normal">Right (open→close)</th>
                      <th className="pb-1 text-right font-normal" title="Hit rate minus the share of stocks that moved that way anyway">Edge vs market</th>
                      <th className="pb-1 text-right font-normal">Right (close→close)</th>
                      <th className="pb-1 text-right font-normal">Avg after costs</th>
                      <th className="pb-1 text-right font-normal">Verdict</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sigs.map((s) => (
                      <tr key={s.key} className="border-t border-line/40">
                        <td className="py-1.5">{s.label}</td>
                        <td className={clsx("py-1.5", s.effect === "bullish" ? "text-up" : "text-down")}>{s.effect}</td>
                        <td className="py-1.5 text-right font-mono">{s.n.toLocaleString("en-IN")}</td>
                        <td className="py-1.5 text-right">
                          <span className={clsx("font-mono", hitTone(s.hitRate, s.n))}>{pct(s.hitRate)}</span>
                          <Bar value={s.hitRate} className={s.hitRate != null && s.hitRate >= 0.5 ? "bg-up/70" : "bg-down/70"} />
                        </td>
                        <td className={clsx("py-1.5 text-right font-mono", s.n < 30 ? "text-muted" : tone(s.edge))}>{s.edge == null ? "—" : `${s.edge >= 0 ? "+" : ""}${(s.edge * 100).toFixed(1)} pts`}</td>
                        <td className={clsx("py-1.5 text-right font-mono", hitTone(s.hitRateCc, s.n))}>{pct(s.hitRateCc)}</td>
                        <td className={clsx("py-1.5 text-right font-mono", tone(s.avgNet))}>{signed(s.avgNet)}</td>
                        <td className="py-1.5 text-right">
                          <span className={clsx("rounded px-1.5 py-0.5 text-[10px]", s.verdict === "keep" ? "bg-up/10 text-up" : s.verdict === "mute" ? "bg-down/10 text-down" : "bg-white/5 text-muted")}>
                            {s.verdict === "learning" ? `learning (${s.n}/${d.thresholds.learn.minSignalObs})` : s.verdict === "mute" ? "muted" : `×${s.mult.toFixed(2)}`}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Calibration */}
            <Card title="Do higher scores win more often?">
              <p className="-mt-1 mb-2 text-[11px] text-muted">{d.calibration.note}</p>
              <div className="space-y-2">
                {d.calibration.buckets.map((b) => (
                  <div key={b.label} className="grid grid-cols-[60px_1fr_auto] items-center gap-2 text-xs">
                    <span className="font-mono">{b.label}</span>
                    <Bar value={b.winRate} className="bg-accent" />
                    <span className="w-40 text-right font-mono text-muted">
                      {b.trades ? `${pct(b.winRate)} of ${b.trades} · ${signed(b.avgReturnPct)}` : "no trades"}
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[10px] text-muted">All closed paper trades (recommended and shadow), by the agent&apos;s score when it made the call.</p>
            </Card>

            {/* Agents */}
            <Card title="Specialist agents — right on closed trades, and their weight">
              <table className="w-full text-xs">
                <thead className="text-left text-muted">
                  <tr>
                    <th className="pb-1 font-normal">Agent</th>
                    <th className="pb-1 text-right font-normal">Calls</th>
                    <th className="pb-1 text-right font-normal">Right</th>
                    <th className="pb-1 text-right font-normal">Research weight</th>
                    <th className="pb-1 text-right font-normal">Weight now</th>
                  </tr>
                </thead>
                <tbody>
                  {(Object.keys(d.weights.research) as AgentId[]).map((a) => {
                    const acc = d.accuracy.find((x) => x.agent === a);
                    const now = d.weights.current.weights[a];
                    const was = d.weights.research[a];
                    return (
                      <tr key={a} className="border-t border-line/40">
                        <td className="py-1.5">{AGENT_LABELS[a] ?? a}</td>
                        <td className="py-1.5 text-right font-mono">{acc?.calls ?? 0}</td>
                        <td className={clsx("py-1.5 text-right font-mono", hitTone(acc?.accuracy ?? null, acc?.calls ?? 0))}>{pct(acc?.accuracy)}</td>
                        <td className="py-1.5 text-right font-mono text-muted">{was}</td>
                        <td className={clsx("py-1.5 text-right font-mono", now > was ? "text-up" : now < was ? "text-down" : "")}>{now}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <ul className="mt-2 space-y-0.5 text-[11px] text-muted">
                {d.weights.current.notes.map((n) => (
                  <li key={n}>· {n}</li>
                ))}
              </ul>
            </Card>
          </div>

          {/* Performance groups */}
          <Card title="Paper-trading results by group">
            <div className="grid gap-3 sm:grid-cols-3">
              {(
                [
                  ["Recommended (the agent's track record)", d.performance.recommended],
                  ["Rejected by the agent (shadow)", d.performance.shadow],
                  ["Blocked by a risk rule (shadow)", d.performance.riskDemoted],
                ] as const
              ).map(([label, s]) => (
                <div key={label} className="rounded-lg bg-white/3 p-3 text-xs">
                  <p className="text-muted">{label}</p>
                  <p className={clsx("mt-1 font-mono text-lg", tone(s.netPnl))}>{inr(s.netPnl)}</p>
                  <p className="text-muted">
                    {s.closed} closed · win {pct(s.winRate)} · PF {s.profitFactor?.toFixed(2) ?? "—"} · expectancy {inr(s.expectancy)}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[10px] text-muted">If the shadow groups lose money, saying no (or the risk rule) was right. Simulated trades only — not investment advice.</p>
          </Card>
        </>
      )}
    </div>
  );
}
