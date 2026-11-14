import { BadgeCheck, FlaskConical, HelpCircle } from "lucide-react";
import { clsx } from "@/lib/format";
import type { TrackRecord } from "@/lib/types";
import { TermLabel } from "./TermLabel";

const pct = (x: number | null, digits = 0) => (x == null ? "—" : `${(x * 100).toFixed(digits)}%`);

/**
 * Shows how this kind of call actually performed out of sample.
 * Proven = beat the average stock after costs; Unproven = did not; Untested = no backtest yet.
 */
export function TrackBadge({ track, detailed = false }: { track: TrackRecord; detailed?: boolean }) {
  const Icon = track.status === "proven" ? BadgeCheck : track.status === "unproven" ? FlaskConical : HelpCircle;
  const label = track.status === "proven" ? "Proven" : track.status === "unproven" ? "Unproven setup" : "Untested";
  const title =
    track.status === "untested"
      ? "This desk's rules have not been backtested yet — treat calls as research ideas."
      : `Out-of-sample (${track.period ?? "test period"}): right ${pct(track.hitRate)} of the time over ${track.horizonDays} trading days; ${pct(track.expectancy, 2)} per trade after costs; profit factor ${track.profitFactor?.toFixed(2) ?? "—"}; ${track.samples} signals.`;

  const chip = (
    <span
      title={title}
      className={clsx(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
        track.status === "proven" ? "bg-up/15 text-up" : track.status === "unproven" ? "bg-warn/15 text-warn" : "bg-white/8 text-muted",
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
      {track.hitRate != null && <span className="font-normal opacity-80">· {pct(track.hitRate)} hit</span>}
    </span>
  );
  if (!detailed) return chip;

  return (
    <div className="space-y-2">
      {chip}
      {track.status === "untested" ? (
        <p className="text-xs text-muted">No backtest exists for this call yet — treat it as a research idea, not a prediction.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-1.5 text-xs">
            <Metric label="Hit rate" value={pct(track.hitRate)} hint={`over ${track.horizonDays} trading days`} />
            <Metric label="Per trade, after costs" value={pct(track.expectancy, 2)} tone={(track.expectancy ?? 0) > 0 ? "up" : "down"} />
            <Metric label="Profit factor" value={track.profitFactor?.toFixed(2) ?? "—"} tone={(track.profitFactor ?? 0) >= 1 ? "up" : "down"} />
            <Metric label="vs average stock" value={pct(track.edge, 2)} tone={(track.edge ?? 0) > 0 ? "up" : "down"} />
          </div>
          <p className="text-[11px] leading-relaxed text-muted">
            {track.status === "proven"
              ? "This call beat the average stock after trading costs on data the rules never saw."
              : "This call did not beat the average stock after trading costs on unseen data. It is a setup to research, not a prediction."}{" "}
            Based on {track.samples.toLocaleString("en-IN")} out-of-sample signals ({track.period}).
          </p>
        </>
      )}
    </div>
  );
}

function Metric({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "up" | "down" }) {
  return (
    <div className="rounded-lg bg-white/5 px-2 py-1.5">
      <p className="text-[10px] text-muted"><TermLabel label={label} /></p>
      <p className={clsx("font-mono", tone === "up" && "text-up", tone === "down" && "text-down")}>{value}</p>
      {hint && <p className="text-[10px] text-muted">{hint}</p>}
    </div>
  );
}
