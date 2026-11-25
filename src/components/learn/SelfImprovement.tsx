"use client";

import { Brain } from "lucide-react";
import type { ImproveState, SetupStatus } from "@/lib/learn/improve";
import { DEFAULT_TUNING, describeExit } from "@/lib/learn/improve";
import { clsx } from "@/lib/format";
import { Card } from "../shell/PageHeader";

const r = (x: number, d = 2) => `${x >= 0 ? "+" : ""}${x.toFixed(d)}R`;
const STATUS: Record<SetupStatus, { label: string; cls: string }> = {
  proven: { label: "Proven · full size", cls: "bg-up/15 text-up" },
  unproven: { label: "Unproven · half size", cls: "bg-warn/15 text-warn" },
  probation: { label: "Learning · half size", cls: "bg-white/8 text-muted" },
  blocked: { label: "Blocked · shadow only", cls: "bg-down/15 text-down" },
};

/** What the self-improvement engine has learned from the paper trades, and what it changed. */
export function SelfImprovement({ state }: { state: ImproveState | null }) {
  if (!state) {
    return (
      <Card title="Self-improvement — learning from mistakes">
        <p className="text-sm text-muted">Not run yet. It runs every night after the close (and with &quot;Run learning now&quot;) once there are closed paper trades.</p>
      </Card>
    );
  }
  const t = state.tuning;
  const exitsChanged = t.stopScale !== DEFAULT_TUNING.stopScale || t.targetR !== DEFAULT_TUNING.targetR || t.breakEvenR !== DEFAULT_TUNING.breakEvenR;
  return (
    <Card title="Self-improvement — learning from mistakes">
      <div className="-mt-1 mb-3 flex flex-wrap items-center gap-2 text-[11px] text-muted">
        <Brain className="h-3.5 w-3.5 text-accent" />
        {state.diagnosed} trade post-mortems · {state.trades} closed trades in the ledger · updated {new Date(state.updatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })} IST
        {state.defensive && <span className="rounded bg-down/15 px-1.5 py-0.5 font-semibold text-down">Defensive mode</span>}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Rules the engine trades with now</h3>
          <ul className="mt-2 space-y-1 text-sm">
            <li>· Exits: {exitsChanged ? <b className="text-accent">{describeExit(t)}</b> : describeExit(t)}</li>
            <li>· Opening range: {t.orbMinutes} minutes{t.orbMinutes !== DEFAULT_TUNING.orbMinutes && <b className="text-accent"> (learned)</b>}</li>
            <li>· Market-direction filter: {t.marketAlign ? <b className="text-accent">on (learned)</b> : "off"}</li>
            <li>· Minimum score: {t.minScore != null ? <b className="text-accent">{t.minScore}+ (learned)</b> : "none beyond the validator"}</li>
          </ul>
          {state.changes.length > 0 && (
            <>
              <h3 className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-accent">Changed last night</h3>
              <ul className="mt-1 space-y-1 text-sm">
                {state.changes.map((c) => (
                  <li key={c}>· {c}</li>
                ))}
              </ul>
            </>
          )}
          <h3 className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-muted">Lessons</h3>
          <ul className="mt-1 space-y-1 text-sm">
            {state.lessons.map((l) => (
              <li key={l}>· {l}</li>
            ))}
          </ul>
        </div>

        <div className="space-y-4">
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Why losing trades lost</h3>
            {state.causes.length ? (
              <div className="mt-2 space-y-1.5">
                {state.causes.map((c) => (
                  <div key={c.cause} className="text-xs">
                    <div className="flex justify-between">
                      <span>{c.label}</span>
                      <span className="text-muted">
                        {c.count} · {(c.share * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div className="mt-0.5 h-1.5 rounded-full bg-white/5">
                      <div className="h-1.5 rounded-full bg-down/70" style={{ width: `${Math.round(c.share * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-xs text-muted">No measured losses yet.</p>
            )}
          </div>
          {state.alignment && (
            <p className="text-xs text-muted">
              With NIFTY&apos;s direction: {state.alignment.aligned.n} trades, {r(state.alignment.aligned.avgR)} avg · against it: {state.alignment.against.n} trades, {r(state.alignment.against.avgR)} avg.
            </p>
          )}
          {state.exitTest && (
            <p className="text-xs text-muted">
              Exit test on {state.exitTest.trades.train} older + {state.exitTest.trades.test} newer trades — current {r(state.exitTest.current.train)} / {r(state.exitTest.current.test)}, best alternative ({describeExit(state.exitTest.best)}) {r(state.exitTest.best.train)} / {r(state.exitTest.best.test)}.
            </p>
          )}
        </div>
      </div>

      <h3 className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted">Setup ledger (profit decides the size)</h3>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-left text-muted">
            <tr>
              <th className="pb-1 font-normal">Setup</th>
              <th className="pb-1 text-right font-normal">Trades</th>
              <th className="pb-1 text-right font-normal">Won</th>
              <th className="pb-1 text-right font-normal">Avg after costs</th>
              <th className="pb-1 text-right font-normal">Range (±1 s.e.)</th>
              <th className="pb-1 pl-3 font-normal">Status</th>
            </tr>
          </thead>
          <tbody>
            {state.setups.map((s) => (
              <tr key={s.key} className="border-t border-line">
                <td className="py-1.5">{s.label}</td>
                <td className="py-1.5 text-right">{s.n}</td>
                <td className="py-1.5 text-right">{(s.winRate * 100).toFixed(0)}%</td>
                <td className={clsx("py-1.5 text-right font-semibold", s.avgR > 0 ? "text-up" : s.avgR < 0 ? "text-down" : "")}>{r(s.avgR)}</td>
                <td className="py-1.5 text-right text-muted">
                  {r(s.low)} … {r(s.high)}
                </td>
                <td className="py-1.5 pl-3">
                  <span className={clsx("rounded px-1.5 py-0.5 text-[10px] font-semibold", STATUS[s.status].cls)}>{STATUS[s.status].label}</span>
                </td>
              </tr>
            ))}
            {!state.setups.length && (
              <tr>
                <td colSpan={6} className="py-2 text-muted">
                  No closed trades yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {state.journal.length > 0 && (
        <>
          <h3 className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted">Trade journal (latest post-mortems)</h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-muted">
                <tr>
                  <th className="pb-1 font-normal">Day</th>
                  <th className="pb-1 font-normal">Stock</th>
                  <th className="pb-1 font-normal">Side</th>
                  <th className="pb-1 text-right font-normal">Result</th>
                  <th className="pb-1 text-right font-normal">Best / worst</th>
                  <th className="pb-1 pl-3 font-normal">Diagnosis</th>
                </tr>
              </thead>
              <tbody>
                {state.journal.map((j) => (
                  <tr key={j.id} className="border-t border-line">
                    <td className="py-1.5 text-muted">{j.day}</td>
                    <td className="py-1.5">
                      {j.symbol.replace(/\.(NS|BO)$/, "")} <span className="text-[10px] text-muted">{j.origin}{j.kind === "shadow" ? " · shadow" : ""}</span>
                    </td>
                    <td className={clsx("py-1.5", j.side === "long" ? "text-up" : "text-down")}>{j.side}</td>
                    <td className={clsx("py-1.5 text-right font-semibold", j.netR > 0 ? "text-up" : j.netR < 0 ? "text-down" : "")}>{r(j.netR)}</td>
                    <td className="py-1.5 text-right text-muted">
                      {r(j.mfeR, 1)} / {r(j.maeR, 1)}
                    </td>
                    <td className="py-1.5 pl-3">{j.causeText}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="mt-3 text-[10px] text-muted">
        Results are in R: 1R = the money at risk between entry and the original stop, after the 0.1% round-trip cost. Blocked setups keep running as shadow paper trades, so the engine can see when they recover. Set ADAPTIVE_WEIGHTS=off to trade with the fixed research rules.
      </p>
    </Card>
  );
}
