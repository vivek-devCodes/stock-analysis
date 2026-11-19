"use client";

import {
  AlertTriangle,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleX,
  Database,
  FlaskConical,
  Inbox,
  Loader2,
  PlayCircle,
  RefreshCw,
  Scale,
  Timer,
  Users,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "@/lib/format";
import { computeStats, type GroupStats } from "@/lib/paper/stats";
import type { PaperRunResult, PaperSnapshot, PaperTradeView } from "@/lib/paper/types";
import { ValidationBadge } from "../agent/ReportView";
import { Card, PageHeader } from "../shell/PageHeader";
import { PlanAndReports } from "./PlanAndReports";

const AUTO_KEY = "apex-paper-auto";
const AUTO_RETRY_MS = 30 * 60_000;
const POLL_MS = 60_000;

const inr = (x: number | null | undefined, signed = false) =>
  x == null || !Number.isFinite(x)
    ? "—"
    : `${signed && x > 0 ? "+" : x < 0 ? "−" : ""}₹${Math.abs(x).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const px = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? "—" : x.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const pctOf = (x: number | null | undefined, d = 0) => (x == null || !Number.isFinite(x) ? "—" : `${(x * 100).toFixed(d)}%`);
const signedPct = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? "—" : `${x > 0 ? "+" : ""}${x.toFixed(2)}%`);
const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }) : "—");
const dayLabel = (d: string) => new Date(`${d}T00:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" });
const short = (s: string) => s.replace(/\.(NS|BO)$/, "");
const tone = (x: number | null | undefined) => (x == null || x === 0 ? "text-foreground" : x > 0 ? "text-up" : "text-down");

async function readJson<T>(res: Response): Promise<T | null> {
  if (res.status === 401) {
    window.location.replace("/login");
    return null;
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error || `Request failed (HTTP ${res.status})`);
  return json as T;
}

function readAuto() {
  try {
    return window.localStorage.getItem(AUTO_KEY) !== "off";
  } catch {
    return true;
  }
}

/* ---------------------------------------------------------------- pieces */

function Tile({ label, value, sub, valueClass }: { label: string; value: string; sub?: string; valueClass?: string }) {
  return (
    <div className="panel p-3">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted">{label}</p>
      <p className={clsx("mt-1 font-mono text-xl font-semibold", valueClass)}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-muted">{sub}</p>}
    </div>
  );
}

function Meter({ value }: { value: number | null }) {
  return (
    <div className="h-2 w-full min-w-[80px] overflow-hidden rounded-full bg-white/[0.06]" aria-hidden>
      {value != null && <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }} />}
    </div>
  );
}

function StatusCell({ t }: { t: PaperTradeView }) {
  if (t.status === "open") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent">
        <Timer className="h-3.5 w-3.5" /> Live
      </span>
    );
  }
  const label = t.status === "target" ? "Target hit" : t.status === "stop" ? "Stop-loss hit" : "Squared off";
  return <span className="text-[11px] font-medium text-foreground/85">{label}</span>;
}

function Verdict({ t }: { t: PaperTradeView }) {
  if (t.status === "open") {
    const u = t.unrealizedPnl;
    return <span className="text-[11px] text-muted">{u == null ? "Pending" : u > 0 ? "In profit" : u < 0 ? "In loss" : "Flat"}</span>;
  }
  const ok = (t.netPnl ?? 0) > 0;
  return ok ? (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-up">
      <CircleCheck className="h-3.5 w-3.5" /> Correct
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-down">
      <CircleX className="h-3.5 w-3.5" /> Wrong
    </span>
  );
}

function GroupRow({ label, hint, s }: { label: string; hint?: string; s: GroupStats }) {
  return (
    <tr className="border-b border-line/60 align-top">
      <td className="px-2 py-2">
        <p className="font-semibold">{label}</p>
        {hint && <p className="max-w-[280px] text-[11px] text-muted">{hint}</p>}
      </td>
      <td className="px-2 py-2 text-right font-mono">
        {s.closed}
        {s.open > 0 && <span className="text-muted"> +{s.open} live</span>}
      </td>
      <td className="px-2 py-2">
        <div className="flex items-center gap-2">
          <Meter value={s.winRate} />
          <span className="w-10 text-right font-mono">{pctOf(s.winRate)}</span>
        </div>
      </td>
      <td className="px-2 py-2 text-right font-mono">{s.targetHits} / {s.stopHits} / {s.squareOffs}</td>
      <td className={clsx("px-2 py-2 text-right font-mono", tone(s.netPnl))}>{s.closed ? inr(s.netPnl, true) : "—"}</td>
      <td className={clsx("px-2 py-2 text-right font-mono", tone(s.avgReturnPct))}>{signedPct(s.avgReturnPct)}</td>
    </tr>
  );
}

/* ---------------------------------------------------------------- page */

export function PaperTrading() {
  const [snap, setSnap] = useState<PaperSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState<null | "auto" | "manual">(null);
  const [elapsed, setElapsed] = useState(0);
  const [lastRun, setLastRun] = useState<PaperRunResult | null>(null);
  const [auto, setAuto] = useState(true);
  const [filter, setFilter] = useState<"all" | "open" | "closed">("all");
  const [showShadow, setShowShadow] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const lastAutoAttempt = useRef(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const j = await readJson<PaperSnapshot>(await fetch("/api/paper", { cache: "no-store" }));
      if (j) {
        setSnap(j);
        setError(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load paper trades");
    } finally {
      setLoading(false);
    }
  }, []);

  const runAgent = useCallback(
    async (mode: "auto" | "manual") => {
      setRunning(mode);
      setElapsed(0);
      setError(null);
      const tick = window.setInterval(() => setElapsed((s) => s + 1), 1000);
      try {
        const r = await readJson<PaperRunResult>(
          await fetch("/api/paper", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: mode === "auto" ? "auto" : "run" }) }),
        );
        if (r) setLastRun(r);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Agent run failed");
      } finally {
        window.clearInterval(tick);
        setRunning(null);
      }
    },
    [load],
  );

  // First load, auto-mode preference, and a refresh every minute (settles trades, updates live P&L).
  useEffect(() => {
    const first = window.setTimeout(() => {
      setAuto(readAuto());
      void load();
    }, 0);
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [load]);

  // Auto mode: as soon as the market is open and the agent hasn't traded today, trigger it.
  useEffect(() => {
    if (!auto || !snap || running) return;
    if (snap.phase !== "open" || snap.autoRanToday) return;
    if (Date.now() - lastAutoAttempt.current < AUTO_RETRY_MS) return;
    lastAutoAttempt.current = Date.now();
    const id = window.setTimeout(() => void runAgent("auto"), 0);
    return () => window.clearTimeout(id);
  }, [auto, snap, running, runAgent]);

  const toggleAuto = () => {
    const next = !auto;
    setAuto(next);
    try {
      window.localStorage.setItem(AUTO_KEY, next ? "on" : "off");
    } catch {
      /* per-browser preference only */
    }
  };

  const trades = useMemo(() => snap?.trades ?? [], [snap]);
  const stats = useMemo(() => computeStats(trades), [trades]);
  const o = stats.overall;
  const unrealized = trades.filter((t) => t.kind === "recommended" && t.status === "open").reduce((a, t) => a + (t.unrealizedPnl ?? 0), 0);
  const openCount = trades.filter((t) => t.kind === "recommended" && t.status === "open").length;

  const visible = trades.filter(
    (t) => (showShadow || t.kind === "recommended") && (filter === "all" || (filter === "open" ? t.status === "open" : t.status !== "open")),
  );
  const shadowCount = trades.filter((t) => t.kind === "shadow").length;
  const s = snap?.settings;

  return (
    <div className="space-y-5">
      <PageHeader
        icon={FlaskConical}
        tone="text-[#fb923c]"
        title="Paper Trading"
        subtitle="The AI agent picks intraday trades with its own entry, target and stop-loss. Each one is traded on paper immediately and scored automatically. No real money is used."
        actions={
          <>
            <button
              type="button"
              onClick={toggleAuto}
              aria-pressed={auto}
              className={clsx("inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm", auto ? "border-up/40 bg-up/10 text-up" : "border-line text-muted hover:bg-white/5")}
            >
              <span className={clsx("h-2 w-2 rounded-full", auto ? "bg-up" : "bg-muted")} aria-hidden />
              Auto-trade {auto ? "on" : "off"}
            </button>
            <button
              type="button"
              onClick={() => void runAgent("manual")}
              disabled={running != null}
              className="inline-flex items-center gap-2 rounded-xl bg-[#ea580c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#ea580c]/90 disabled:opacity-50"
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
              {running ? `Agent scanning… ${elapsed}s` : "Run agent now"}
            </button>
            <button type="button" onClick={() => void load()} disabled={loading} className="rounded-xl border border-line p-2 text-muted hover:bg-white/5 disabled:opacity-50" aria-label="Refresh">
              <RefreshCw className={clsx("h-4 w-4", loading && "animate-spin")} />
            </button>
          </>
        }
      />

      {/* Market status + how it works */}
      <div className="panel flex flex-wrap items-center gap-x-4 gap-y-2 p-3 text-xs">
        <span className={clsx("inline-flex items-center gap-2 font-semibold", snap?.phase === "open" ? "text-up" : snap?.phase === "no-new-entries" || snap?.phase === "warm-up" ? "text-warn" : "text-muted")}>
          <span className={clsx("h-2 w-2 rounded-full", snap?.phase === "open" ? "bg-up" : snap?.phase === "no-new-entries" || snap?.phase === "warm-up" ? "bg-warn" : "bg-muted")} aria-hidden />
          {snap ? snap.phaseLabel : "Checking market…"}
        </span>
        {snap && (
          <span className="text-muted">
            {snap.autoRanToday ? "The agent has traded today." : auto ? "Auto-trade starts the agent as soon as the market is open, while this page is open (a daily cron also runs it at ~09:35 IST)." : "Auto-trade is off — use “Run agent now”."}
          </span>
        )}
        {running && <span className="text-muted">Analysing the shortlist with every specialist agent. This takes 1–4 minutes.</span>}
      </div>

      {error && (
        <p className="flex items-center gap-2 text-sm text-down">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </p>
      )}
      {snap && <PlanAndReports plan={snap.plan} reports={snap.reports} phase={snap.phase} onChanged={() => void load()} />}

      {snap?.note && (
        <p className="flex items-start gap-2 rounded-xl border border-warn/30 bg-warn/5 p-3 text-xs text-foreground/85">
          <Database className="mt-0.5 h-4 w-4 shrink-0 text-warn" /> {snap.note}
        </p>
      )}

      {lastRun && (
        <Card icon={PlayCircle} title={`Last agent run · ${time(lastRun.at)} IST`} tone="text-[#fb923c]">
          <div className="space-y-1.5 text-xs">
            {lastRun.plan && (
              <p>
                <span className="font-semibold">Last night&apos;s plan first:</span>{" "}
                {lastRun.plan.rows.map((r) => `${short(r.symbol)} ${r.entered ? "entered" : `skipped (${r.reason})`}`).join(" · ") || "no ideas"}
              </p>
            )}
            {lastRun.skipped && <p className="text-muted">{lastRun.skipped}</p>}
            {lastRun.shortlisted.length > 0 && (
              <p>
                Shortlisted {lastRun.shortlisted.map(short).join(", ")} · analysed {lastRun.analysed} ·{" "}
                <span className="font-semibold">{lastRun.opened.length} trade{lastRun.opened.length === 1 ? "" : "s"} entered</span>
              </p>
            )}
            {lastRun.opened.map((x) => (
              <p key={x.symbol}>
                • {x.side === "long" ? "BUY" : "SELL"} {short(x.symbol)} — {x.kind === "shadow" ? "agent said NO TRADE (tracked as shadow)" : x.decision}
              </p>
            ))}
            {lastRun.notTraded.map((x) => (
              <p key={x.symbol} className="text-muted">
                • {short(x.symbol)} not traded: {x.reason}
              </p>
            ))}
            {lastRun.errors.length > 0 && <p className="text-warn">Data issues: {lastRun.errors.slice(0, 3).join(" | ")}</p>}
          </div>
        </Card>
      )}

      {/* Headline numbers — recommended trades only */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Decision accuracy" value={pctOf(o.winRate)} sub={o.closed ? `${o.wins} correct of ${o.closed} closed` : "No closed trades yet"} />
        <Tile
          label="Net P&L (closed)"
          value={inr(o.netPnl, true)}
          valueClass={tone(o.netPnl)}
          sub={openCount ? `${inr(unrealized, true)} unrealised on ${openCount} live` : `after ${s?.costPct ?? 0.1}% costs`}
        />
        <Tile label="Target / stop-loss hit" value={`${o.targetHits} / ${o.stopHits}`} sub={`${o.squareOffs} squared off at ${s?.squareOff ?? "15:15"}`} />
        <Tile label="Profit factor" value={o.profitFactor == null ? "—" : o.profitFactor.toFixed(2)} sub="profit ÷ loss · above 1 is profitable" />
        <Tile label="Total profit" value={inr(o.grossProfit)} valueClass={o.grossProfit > 0 ? "text-up" : undefined} sub={`${o.wins} winning trade${o.wins === 1 ? "" : "s"}`} />
        <Tile label="Total loss" value={o.grossLoss ? inr(-o.grossLoss) : "₹0"} valueClass={o.grossLoss > 0 ? "text-down" : undefined} sub={`${o.losses} losing trade${o.losses === 1 ? "" : "s"}`} />
        <Tile label="Avg profit / avg loss" value={`${inr(o.avgWin)} / ${o.avgLoss == null ? "—" : inr(o.avgLoss)}`} sub="per closed trade" />
        <Tile label="Expectancy" value={inr(o.expectancy, true)} valueClass={tone(o.expectancy)} sub="average result per trade" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card icon={Scale} title="Is the agent's decision correct?" tone="text-[#fb923c]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-xs">
              <thead>
                <tr className="border-b border-line text-left text-muted">
                  <th className="px-2 py-1.5 font-medium">Agent verdict</th>
                  <th className="px-2 py-1.5 text-right font-medium">Closed</th>
                  <th className="px-2 py-1.5 font-medium">Correct</th>
                  <th className="px-2 py-1.5 text-right font-medium">Target / SL / sq-off</th>
                  <th className="px-2 py-1.5 text-right font-medium">Net P&amp;L</th>
                  <th className="px-2 py-1.5 text-right font-medium">Avg return</th>
                </tr>
              </thead>
              <tbody>
                {stats.byVerdict.map((g) => (
                  <GroupRow key={g.key} label={g.label} hint={g.hint} s={g.stats} />
                ))}
                {stats.bySide.map((g) => (
                  <GroupRow key={g.key} label={g.label} s={g.stats} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-muted">A trade is “correct” when it closes with a profit after costs. Long and short rows cover recommended trades only.</p>
        </Card>

        <Card icon={Users} title="Which specialist agent is right?" tone="text-[#a78bfa]">
          {stats.agents.every((a) => a.calls === 0) ? (
            <p className="text-xs text-muted">Appears once trades close. Each specialist is scored on whether its bullish or bearish view matched the price move from entry to exit.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-line text-left text-muted">
                  <th className="px-2 py-1.5 font-medium">Specialist</th>
                  <th className="px-2 py-1.5 text-right font-medium">Right / calls</th>
                  <th className="px-2 py-1.5 font-medium">Accuracy</th>
                </tr>
              </thead>
              <tbody>
                {stats.agents.map((a) => (
                  <tr key={a.agent} className="border-b border-line/60">
                    <td className="px-2 py-2">
                      {a.label}
                      {a.neutral > 0 && <span className="block text-[10px] text-muted">{a.neutral} neutral (not counted)</span>}
                    </td>
                    <td className="px-2 py-2 text-right font-mono">
                      {a.correct} / {a.calls}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-2">
                        <Meter value={a.accuracy} />
                        <span className="w-10 text-right font-mono">{pctOf(a.accuracy)}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {/* Trade list */}
      <Card
        icon={Inbox}
        title="Trades"
        tone="text-accent"
        action={
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {(["all", "open", "closed"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                aria-pressed={filter === f}
                className={clsx("rounded-lg border px-2.5 py-1 capitalize", filter === f ? "border-accent/50 bg-accent/10 text-foreground" : "border-line text-muted hover:bg-white/5")}
              >
                {f === "open" ? "Live" : f}
              </button>
            ))}
            <label className="ml-1 inline-flex cursor-pointer items-center gap-1.5 text-muted">
              <input type="checkbox" checked={showShadow} onChange={(e) => setShowShadow(e.target.checked)} className="accent-[#ea580c]" />
              Show rejected ({shadowCount})
            </label>
          </div>
        }
      >
        {snap == null ? (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading trades…
          </p>
        ) : visible.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Inbox className="h-4 w-4" />
            {trades.length === 0 ? "No paper trades yet. The agent trades between 09:30 and 14:30 IST on market days." : "No trades match this filter."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-xs">
              <thead>
                <tr className="border-b border-line text-left text-muted">
                  <th className="px-2 py-1.5 font-medium" />
                  <th className="px-2 py-1.5 font-medium">Day · time</th>
                  <th className="px-2 py-1.5 font-medium">Stock</th>
                  <th className="px-2 py-1.5 font-medium">Agent call</th>
                  <th className="px-2 py-1.5 text-right font-medium">Buy / sell price</th>
                  <th className="px-2 py-1.5 text-right font-medium">Target</th>
                  <th className="px-2 py-1.5 text-right font-medium">Stop-loss</th>
                  <th className="px-2 py-1.5 text-right font-medium">Qty</th>
                  <th className="px-2 py-1.5 font-medium">Status</th>
                  <th className="px-2 py-1.5 text-right font-medium">Exit / last</th>
                  <th className="px-2 py-1.5 text-right font-medium">P&amp;L</th>
                  <th className="px-2 py-1.5 font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((t) => {
                  const isOpen = expanded === t.id;
                  const value = t.status === "open" ? t.unrealizedPnl : t.netPnl;
                  return (
                    <Fragment key={t.id}>
                      <tr className={clsx("border-b border-line/60 align-top", t.kind === "shadow" && "opacity-70")}>
                        <td className="px-2 py-2">
                          <button type="button" onClick={() => setExpanded(isOpen ? null : t.id)} aria-expanded={isOpen} aria-label={`Details for ${short(t.symbol)}`} className="rounded p-0.5 text-muted hover:bg-white/5">
                            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                        </td>
                        <td className="whitespace-nowrap px-2 py-2">
                          {dayLabel(t.tradeDay)}
                          <span className="block text-[11px] text-muted">
                            {time(t.openedAt)} · {t.trigger}
                          </span>
                        </td>
                        <td className="px-2 py-2">
                          <p className="font-semibold">{short(t.symbol)}</p>
                          <p className="max-w-[150px] truncate text-[11px] text-muted">{t.name}</p>
                        </td>
                        <td className="px-2 py-2">
                          <p className="font-semibold">{t.side === "long" ? "BUY → sell" : "SELL → buy back"}</p>
                          {t.kind === "shadow" ? <span className="text-[11px] text-muted">Rejected · NO TRADE</span> : <ValidationBadge v={t.validation} />}
                        </td>
                        <td className="px-2 py-2 text-right font-mono">{px(t.entry)}</td>
                        <td className="px-2 py-2 text-right font-mono">{px(t.target)}</td>
                        <td className="px-2 py-2 text-right font-mono">{px(t.stop)}</td>
                        <td className="px-2 py-2 text-right font-mono">{t.qty}</td>
                        <td className="px-2 py-2">
                          <StatusCell t={t} />
                          {t.exitAt && <span className="block text-[11px] text-muted">{time(t.exitAt)}</span>}
                        </td>
                        <td className="px-2 py-2 text-right font-mono">{px(t.status === "open" ? t.lastPrice : t.exitPrice)}</td>
                        <td className={clsx("px-2 py-2 text-right font-mono", tone(value))}>
                          {inr(value, true)}
                          {t.returnPct != null && <span className="block text-[11px]">{signedPct(t.returnPct)}</span>}
                        </td>
                        <td className="px-2 py-2">
                          <Verdict t={t} />
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="border-b border-line/60 bg-white/[0.015]">
                          <td />
                          <td colSpan={11} className="space-y-2 px-2 py-3">
                            {t.reasons.map((r) => (
                              <p key={r} className="break-words">• {r}</p>
                            ))}
                            <div className="flex flex-wrap gap-1.5">
                              {t.votes.map((v) => (
                                <span key={v.agent} className="rounded-md border border-line px-2 py-0.5 text-[11px]">
                                  {v.agent}: <span className={v.bias === "bullish" ? "text-up" : v.bias === "bearish" ? "text-down" : "text-muted"}>{v.bias ?? "n/a"}</span>
                                  {v.score != null && <span className="text-muted"> · {v.score}</span>}
                                </span>
                              ))}
                            </div>
                            <p className="text-[11px] text-muted">
                              Score {t.score ?? "—"}/100 · reward:risk {t.riskReward?.toFixed(2) ?? "—"} · position value {inr(t.entry * t.qty)}
                              {t.costs != null && ` · costs ${inr(t.costs)}`}
                              {t.reportId && (
                                <>
                                  {" · "}
                                  <a href={`/agent?symbol=${encodeURIComponent(t.symbol)}&horizon=intraday`} className="text-accent hover:underline">
                                    re-run analysis
                                  </a>
                                </>
                              )}
                            </p>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card icon={CalendarDays} title="Results by day" tone="text-accent">
          {stats.days.length === 0 ? (
            <p className="text-xs text-muted">No trading days yet.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-line text-left text-muted">
                  <th className="px-2 py-1.5 font-medium">Day</th>
                  <th className="px-2 py-1.5 text-right font-medium">Trades</th>
                  <th className="px-2 py-1.5 text-right font-medium">Correct</th>
                  <th className="px-2 py-1.5 text-right font-medium">Net P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {stats.days.map((d) => (
                  <tr key={d.day} className="border-b border-line/60">
                    <td className="px-2 py-2">{dayLabel(d.day)}</td>
                    <td className="px-2 py-2 text-right font-mono">{d.trades}</td>
                    <td className="px-2 py-2 text-right font-mono">{d.closed ? `${d.wins} / ${d.closed}` : "—"}</td>
                    <td className={clsx("px-2 py-2 text-right font-mono", tone(d.netPnl))}>{d.closed ? inr(d.netPnl, true) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card icon={Scale} title="How trades are simulated" tone="text-[#fbbf24]">
          <ul className="space-y-1 text-xs text-foreground/85">
            <li>• Intraday only. The agent enters between {s?.entryWindow ?? "09:30–14:30 IST"}, at most one trade per stock per day.</li>
            <li>• Entry is the live price when the agent decides. Target and stop-loss are the agent&apos;s own levels.</li>
            <li>• Size: ₹{(s?.capital ?? 100000).toLocaleString("en-IN")} capital, {s?.riskPct ?? 1}% risked per trade (quantity = risk ÷ stop distance).</li>
            <li>• Exit at the target or stop-loss, whichever the 5-minute candles reach first; otherwise squared off at {s?.squareOff ?? "15:15 IST"}.</li>
            <li>• Conservative fills: if one candle touches both, the stop-loss counts first; a gap past the stop exits at the worse price.</li>
            <li>• P&amp;L is after {s?.costPct ?? 0.1}% round-trip costs (brokerage, STT, fees). Short trades are intraday-only, as in a real account.</li>
            <li>• Rejected setups (NO TRADE) are tracked separately as shadow trades and never counted in the headline numbers.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
