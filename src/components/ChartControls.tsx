"use client";

import { ChevronDown, FlaskConical, LineChart, Signal } from "lucide-react";
import { useState } from "react";
import { SIGNAL_COLORS, SIGNALS, STUDIES, STUDY_GROUPS, type SignalId, type StudyId } from "@/lib/chart-config";
import { clsx } from "@/lib/format";

const pct = (x: number | undefined | null, d = 0) => (x == null ? "—" : `${(x * 100).toFixed(d)}%`);

/** Indicator (study) and BUY/SELL signal toggles for the price chart. */
export function ChartControls({
  studies,
  signals,
  onStudies,
  onSignals,
  intraday,
}: {
  studies: StudyId[];
  signals: SignalId[];
  onStudies: (s: StudyId[]) => void;
  onSignals: (s: SignalId[]) => void;
  intraday: boolean;
}) {
  const [open, setOpen] = useState(false);
  const toggle = <T,>(list: T[], id: T) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  return (
    <div className="space-y-2">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs hover:bg-white/5"
      >
        <LineChart className="h-3.5 w-3.5 text-accent" />
        Indicators ({studies.length}) · Signals ({signals.length})
        <ChevronDown className={clsx("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="grid gap-3 rounded-xl border border-line bg-[#0b1016] p-3 text-xs md:grid-cols-2">
          <div>
            <p className="mb-1.5 font-semibold uppercase tracking-wider text-muted">Indicators</p>
            {STUDY_GROUPS.map((g) => (
              <div key={g} className="mb-2">
                <p className="mb-1 text-[10px] text-muted">{g}</p>
                <div className="flex flex-wrap gap-1.5">
                  {STUDIES.filter((s) => s.group === g).map((s) => {
                    const disabled = s.intradayOnly && !intraday;
                    return (
                      <button
                        key={s.id}
                        title={disabled ? `${s.hint} (switch to 1D or 5D to use it)` : s.hint}
                        disabled={disabled}
                        onClick={() => onStudies(toggle(studies, s.id))}
                        className={clsx(
                          "rounded-md border px-2 py-1",
                          studies.includes(s.id) ? "border-accent bg-accent/15 text-accent" : "border-line text-muted hover:text-foreground",
                          disabled && "cursor-not-allowed opacity-40",
                        )}
                      >
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <div>
            <p className="mb-1.5 flex items-center gap-1 font-semibold uppercase tracking-wider text-muted">
              <Signal className="h-3.5 w-3.5" /> BUY / SELL markers
            </p>
            <div className="space-y-1.5">
              {SIGNALS.map((s) => {
                return (
                  <label key={s.id} className="flex items-start gap-2" title={s.hint}>
                    <input type="checkbox" className="mt-0.5" checked={signals.includes(s.id)} onChange={() => onSignals(toggle(signals, s.id))} />
                    <span>
                      <span className="font-medium text-foreground">{s.label}</span>
                      <span className="block text-[11px] text-muted">{s.hint}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Track record of each active marker type, so a marker is never mistaken for a guarantee. */
export function SignalLegend({ signals }: { signals: SignalId[] }) {
  const active = SIGNALS.filter((s) => signals.includes(s.id));
  if (!active.length) return null;
  return (
    <div className="mt-2 space-y-1 rounded-lg border border-line bg-[#0b1016] p-2 text-[11px]">
      <p className="flex items-center gap-1 font-semibold text-muted">
        <FlaskConical className="h-3.5 w-3.5 text-warn" /> How past markers performed (unseen data, after 0.3% costs)
      </p>
      {active.map((s) => (
        <p key={s.id} className="text-foreground/85">
          <span className="mr-1 font-mono" aria-hidden>
            <span style={{ color: SIGNAL_COLORS[s.id].buy }}>▲</span>
            <span style={{ color: SIGNAL_COLORS[s.id].sell }}>▼</span>
          </span>
          <span className="font-medium">{s.label}</span>
          {s.id === "engine" && <span className="text-muted"> (B / S)</span>}
          {s.id === "golden-cross" && <span className="text-muted"> (GC / DC)</span>}
          {s.track ? (
            <>
              {" "}
              ({s.track.horizonDays}-day): BUY right {pct(s.track.buy?.hitRate)}, {pct(s.track.buy?.expectancy, 2)}/trade · SELL right {pct(s.track.sell?.hitRate)},{" "}
              {pct(s.track.sell?.expectancy, 2)}/trade —{" "}
              <span className={s.track.buy?.proven || s.track.sell?.proven ? "text-up" : "text-warn"}>
                {s.track.buy?.proven || s.track.sell?.proven ? "proven" : "unproven"}
              </span>
            </>
          ) : (
            " — not backtested yet"
          )}
        </p>
      ))}
      <p className="text-muted">Markers show where a rule fired in the past; they are research signals, not guaranteed trades.</p>
    </div>
  );
}
