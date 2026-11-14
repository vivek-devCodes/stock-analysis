"use client";

import { AlertTriangle, CalendarClock, ChevronDown, ChevronRight, Database, Inbox, ListChecks, Loader2, PlayCircle, Scale, Workflow } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { clsx } from "@/lib/format";
import { describeRules } from "@/lib/agents/thresholds";
import { HORIZONS, type ScanItem, type ScanRun, type ScanSession } from "@/lib/agents/types";
import { Card } from "../shell/PageHeader";
import { ValidationBadge } from "./ReportView";

const SESSIONS: Array<{ id: ScanSession; label: string; hint: string }> = [
  { id: "premarket", label: "Pre-market", hint: "Swing, long-term and next-session intraday watchlist" },
  { id: "intraday", label: "Intraday", hint: "Live intraday scan (skipped when the market is closed)" },
  { id: "postmarket", label: "Post-market", hint: "Records outcomes, then swing, long-term and next-session plan" },
];

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const pct = (x: number | null | undefined, d = 1) => (x == null || !Number.isFinite(x) ? "—" : `${(x * 100).toFixed(d)}%`);
const f = (x: number) => x.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const short = (s: string) => s.replace(/\.NS$/, "");

async function readJson<T>(res: Response): Promise<T | null> {
  if (res.status === 401) {
    window.location.replace("/login");
    return null;
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error || `Request failed (HTTP ${res.status})`);
  return json as T;
}

function ItemRow({ i }: { i: ScanItem }) {
  return (
    <tr className="border-b border-line/60 align-top">
      <td className="px-2 py-2">
        <p className="font-semibold">{short(i.symbol)}</p>
        <p className="max-w-[160px] truncate text-[11px] text-muted">{i.name}</p>
      </td>
      <td className="px-2 py-2">
        <p className="font-semibold">{i.decision}</p>
        <ValidationBadge v={i.validation} />
      </td>
      <td className="px-2 py-2 text-right font-mono">{i.score ?? "—"}</td>
      <td className="px-2 py-2 text-[11px]">
        {i.plan ? (
          <>
            {i.plan.direction === "long" ? "Buy" : "Sell"} {f(i.plan.entryLow)}–{f(i.plan.entryHigh)}
            <br />
            stop {f(i.plan.stop)} · T1 {f(i.plan.target1)}
            {i.plan.riskReward ? ` · R:R ${i.plan.riskReward.toFixed(1)}` : ""}
            <br />
            <span className="text-muted">{i.plan.illustrative ? "qty illustrative" : `qty ${i.plan.quantity}`}</span>
          </>
        ) : (
          <span className="text-muted">No plan</span>
        )}
      </td>
      <td className="px-2 py-2 text-[11px]">
        {i.evidence.probabilityType === "backtested" ? (
          <>
            Backtested: {pct(i.evidence.hitRate, 0)} hit, {pct(i.evidence.expectancyPct, 2)}/trade
            <br />
            <span className="text-muted">{i.evidence.samples.toLocaleString("en-IN")} signals</span>
          </>
        ) : (
          <span className="text-muted">Unknown — no validated probability</span>
        )}
      </td>
      <td className="max-w-[340px] px-2 py-2 text-[11px]">
        {i.reasons.slice(0, 2).map((r) => (
          <p key={r} className="break-words">• {r}</p>
        ))}
        {i.failedChecks.length > 0 && <p className="mt-1 break-words text-down">Failed: {i.failedChecks.slice(0, 2).join(" | ")}</p>}
      </td>
    </tr>
  );
}

function RunDetail({ run }: { run: ScanRun }) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">
        Market regime: {run.marketRegime} · {run.note}
      </p>
      {run.horizons.map((h) => (
        <div key={h.horizon} className="space-y-2">
          <p className="text-sm font-semibold">
            {HORIZONS.find((x) => x.id === h.horizon)?.label ?? h.horizon}
            <span className="ml-2 text-xs font-normal text-muted">
              screened {h.screened} → shortlisted {h.shortlisted.length}
              {h.shortlisted.length ? ` (${h.shortlisted.map(short).join(", ")})` : ""}
            </span>
          </p>
          {h.items.length === 0 ? (
            <p className="flex items-center gap-2 text-xs text-muted">
              <Inbox className="h-4 w-4" /> No candidates passed the screen.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-xs">
                <thead>
                  <tr className="border-b border-line text-left text-muted">
                    <th className="px-2 py-1.5 font-medium">Stock</th>
                    <th className="px-2 py-1.5 font-medium">Decision</th>
                    <th className="px-2 py-1.5 text-right font-medium">Score</th>
                    <th className="px-2 py-1.5 font-medium">Plan</th>
                    <th className="px-2 py-1.5 font-medium">Evidence</th>
                    <th className="px-2 py-1.5 font-medium">Reasons / failed checks</th>
                  </tr>
                </thead>
                <tbody>
                  {h.items.map((i) => (
                    <ItemRow key={i.symbol + i.horizon} i={i} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
      {run.errors.length > 0 && <p className="text-[11px] text-warn">Data issues: {run.errors.slice(0, 5).join(" | ")}</p>}
    </div>
  );
}

/** Autonomous agent: schedule, recent scan runs and a "run scan now" control. */
export function ScanPanel() {
  const [runs, setRuns] = useState<ScanRun[] | null>(null);
  const [persisted, setPersisted] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [session, setSession] = useState<ScanSession>("postmarket");
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const load = useCallback(() => {
    fetch("/api/agent/scans")
      .then((r) => readJson<{ persisted: boolean; runs: ScanRun[]; note?: string }>(r))
      .then((j) => {
        if (!j) return;
        setRuns(j.runs ?? []);
        setPersisted(j.persisted);
        setNote(j.note ?? null);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load scans"));
  }, []);

  useEffect(() => {
    const id = window.setTimeout(load, 0);
    return () => window.clearTimeout(id);
  }, [load]);

  const runNow = async () => {
    setRunning(true);
    setError(null);
    setElapsed(0);
    const t = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    try {
      const run = await readJson<ScanRun>(await fetch("/api/agent/scans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session }) }));
      if (run) {
        setRuns((prev) => [run, ...(prev ?? []).filter((r) => r.id !== run.id)]);
        setOpen(run.id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      window.clearInterval(t);
      setRunning(false);
    }
  };

  return (
    <Card icon={Workflow} title="Autonomous agent" tone="text-[#a78bfa]">
      <div className="space-y-4">
        <div className="grid gap-2 text-xs sm:grid-cols-3">
          {[
            ["Pre-market · 08:30 IST", "Vercel Cron, Mon–Fri. Swing, long-term and the next-session intraday watchlist; emails a digest."],
            ["Intraday · every 30 min", "During market hours via GitHub Actions, if configured. Alerts only on APPROVED calls."],
            ["Post-market · 16:15 IST", "Vercel Cron, Mon–Fri. Records outcomes of earlier calls, then scans and emails a digest."],
          ].map(([t, d]) => (
            <div key={t} className="rounded-lg border border-line bg-white/[0.02] p-2.5">
              <p className="flex items-center gap-1.5 font-semibold">
                <CalendarClock className="h-3.5 w-3.5 text-[#a78bfa]" aria-hidden /> {t}
              </p>
              <p className="mt-1 text-muted">{d}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1">
            <span className="block text-xs text-muted">Session</span>
            <select value={session} onChange={(e) => setSession(e.target.value as ScanSession)} disabled={running} className="rounded-xl border border-line bg-card px-3 py-2 text-sm">
              {SESSIONS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={runNow}
            disabled={running}
            className="inline-flex items-center gap-2 rounded-xl bg-[#7c3aed] px-4 py-2 text-sm font-semibold text-white hover:bg-[#7c3aed]/90 disabled:opacity-50"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
            {running ? `Scanning… ${elapsed}s` : "Run scan now"}
          </button>
          <p className="text-[11px] text-muted">{SESSIONS.find((s) => s.id === session)?.hint}. Takes 1–4 minutes; does not send email.</p>
        </div>

        {error && (
          <p className="flex items-center gap-2 text-sm text-down">
            <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
          </p>
        )}
        {!persisted && note && (
          <p className="flex items-start gap-2 text-xs text-muted">
            <Database className="mt-0.5 h-4 w-4 shrink-0" /> {note}
          </p>
        )}

        {runs == null ? (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading recent scans…
          </p>
        ) : runs.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Inbox className="h-4 w-4" /> No scans yet. They run on schedule, or use “Run scan now”.
          </p>
        ) : (
          <ul className="space-y-2">
            {runs.map((r) => {
              const isOpen = open === r.id;
              return (
                <li key={r.id} className="rounded-xl border border-line">
                  <button type="button" onClick={() => setOpen(isOpen ? null : r.id)} aria-expanded={isOpen} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 p-3 text-left text-sm">
                    {isOpen ? <ChevronDown className="h-4 w-4 text-muted" /> : <ChevronRight className="h-4 w-4 text-muted" />}
                    <span className="font-semibold">{SESSIONS.find((s) => s.id === r.session)?.label ?? r.session}</span>
                    <span className="text-xs text-muted">{when(r.startedAt)}</span>
                    <span className="text-xs">
                      <span className="text-up">{r.counts.approved} approved</span> · <span className="text-warn">{r.counts.watchlist} watchlist</span> · <span className="text-muted">{r.counts.noTrade} no trade</span>
                    </span>
                    <span className={clsx("ml-auto text-[11px] text-muted")}>{r.marketRegime}</span>
                  </button>
                  {isOpen && (
                    <div className="border-t border-line p-3">
                      <RunDetail run={r} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}

/** Every rule and threshold the engine applies (rendered from the same constants the code uses). */
export function RulesPanel() {
  const groups = describeRules();
  return (
    <Card icon={Scale} title="Rules & thresholds" tone="text-[#fbbf24]">
      <div className="grid gap-4 md:grid-cols-2">
        {groups.map((g) => (
          <div key={g.group}>
            <p className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold">
              <ListChecks className="h-4 w-4 text-muted" aria-hidden /> {g.group}
            </p>
            <ul className="space-y-1 text-xs text-foreground/85">
              {g.rules.map((r) => (
                <li key={r} className="break-words">• {r}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-muted">These values are read from the same constants the engine applies, so this list always matches the decisions.</p>
    </Card>
  );
}
