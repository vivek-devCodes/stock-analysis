"use client";

import Link from "next/link";
import { AlertTriangle, Bot, ChevronDown, ChevronRight, FlaskConical, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { clsx } from "@/lib/format";
import type { QuickVerdict, RiskLevel, RiskProfile, StockInsight } from "@/lib/insights/types";
import { TermLabel } from "../TermLabel";

/** Anything carrying a verdict + risk (StockInsight or SectorStock). */
export type InsightData = { verdict: QuickVerdict; risk: RiskProfile; agentHref: string; price?: number | null; name?: string; asOf?: string };

const pct = (x: number | null | undefined, d = 1) => (x == null || !Number.isFinite(x) ? "—" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)}%`);
const plainPct = (x: number | null | undefined, d = 1) => (x == null || !Number.isFinite(x) ? "—" : `${(x * 100).toFixed(d)}%`);
const num = (x: number | null | undefined, d = 2) => (x == null || !Number.isFinite(x) ? "—" : x.toLocaleString("en-IN", { maximumFractionDigits: d }));

export const STANCE_STYLE: Record<QuickVerdict["stance"], string> = {
  CONSIDER: "bg-up/15 text-up",
  WATCH: "bg-warn/15 text-warn",
  AVOID: "bg-down/15 text-down",
  NEUTRAL: "bg-white/8 text-muted",
};
export const RISK_STYLE: Record<RiskLevel, string> = {
  LOW: "bg-up/15 text-up",
  MEDIUM: "bg-warn/15 text-warn",
  HIGH: "bg-down/15 text-down",
};

export function StanceChip({ stance }: { stance: QuickVerdict["stance"] }) {
  return <span className={clsx("inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-bold", STANCE_STYLE[stance])}>{stance}</span>;
}

export function RiskChip({ level }: { level: RiskLevel }) {
  const Icon = level === "LOW" ? ShieldCheck : ShieldAlert;
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold", RISK_STYLE[level])}>
      <Icon className="h-3 w-3" aria-hidden />
      {level} risk
    </span>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" | "warn" }) {
  return (
    <div className="min-w-0 rounded-lg bg-white/5 px-2 py-1.5">
      <p className="truncate text-[10px] text-muted">
        <TermLabel label={label} />
      </p>
      <p className={clsx("font-mono text-xs", tone === "up" && "text-up", tone === "down" && "text-down", tone === "warn" && "text-warn")}>{value}</p>
    </div>
  );
}

/** The verdict + risk body, given data. */
export function InsightBody({ data, compact = false }: { data: InsightData; compact?: boolean }) {
  const { verdict: v, risk: r } = data;
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <StanceChip stance={v.stance} />
          {v.horizonHint && <span className="text-[10px] text-muted">for {v.horizonHint === "swing" ? "swing (1–2 weeks)" : "long term"}</span>}
          {v.fundamentalScore != null && <span className="text-[10px] text-muted">· fundamentals {v.fundamentalScore}/100</span>}
          {v.trend !== "unknown" && <span className="text-[10px] text-muted">· trend {v.trend}</span>}
        </div>
        <p className="break-words text-sm">{v.summary}</p>
        {v.reasons.length > 0 && (
          <ul className="space-y-0.5 text-xs text-foreground/80">
            {v.reasons.slice(0, compact ? 3 : 6).map((x) => (
              <li key={x} className="break-words">• {x}</li>
            ))}
          </ul>
        )}
        {v.evidence !== "proven" && (
          <p className="flex items-start gap-1.5 rounded-md bg-warn/10 px-2 py-1.5 text-[11px] text-warn">
            <FlaskConical className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            Screening view — rule set {v.evidence}; run the full agent analysis for a validated verdict.
          </p>
        )}
      </div>

      <div className="space-y-2 rounded-lg border border-line p-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Risk management</span>
          <RiskChip level={r.level} />
        </div>
        {r.reasons.length > 0 && (
          <ul className="space-y-0.5 text-[11px] text-muted">
            {r.reasons.map((x) => (
              <li key={x} className="break-words">• {x}</li>
            ))}
          </ul>
        )}
        <div className={clsx("grid gap-1.5", compact ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4")}>
          <Metric label="Volatility" value={plainPct(r.volatilityAnnual, 0)} tone={(r.volatilityAnnual ?? 0) >= 0.4 ? "down" : undefined} />
          <Metric label="Max drawdown (3M)" value={pct(r.maxDrawdown3m)} tone={(r.maxDrawdown3m ?? 0) <= -0.2 ? "down" : undefined} />
          <Metric label="Beta vs NIFTY" value={num(r.beta)} tone={(r.beta ?? 0) >= 1.3 ? "warn" : undefined} />
          <Metric label="VaR 95% (1 day)" value={pct(r.var95OneDay)} tone="down" />
          <Metric label="ATR %" value={plainPct(r.atrPct, 2)} />
          <Metric label="Liquidity" value={r.avgDailyValueCr == null ? "—" : `₹${num(r.avgDailyValueCr, 0)} cr/day`} tone={(r.avgDailyValueCr ?? 99) < 2 ? "down" : undefined} />
          <Metric label="Suggested stop" value={num(r.suggestedStop)} />
          <Metric label="Position (₹1L @ 1%)" value={r.illustrativeQty == null ? "—" : `${r.illustrativeQty} sh`} />
          <Metric label="Max loss at stop" value={r.maxLossAtStop == null ? "—" : `₹${num(r.maxLossAtStop, 0)}`} />
        </div>
        <p className="text-[10px] text-muted">Stop = 2 × daily ATR below price; position sized to risk 1% of an illustrative ₹1,00,000. Gaps can exceed the stop.</p>
      </div>

      <Link
        href={data.agentHref}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[#a78bfa]/40 bg-[#a78bfa]/10 px-3 py-1.5 text-xs font-medium text-[#c4b5fd] hover:bg-[#a78bfa]/20"
      >
        <Bot className="h-3.5 w-3.5" aria-hidden />
        Full agent analysis
      </Link>
    </div>
  );
}

/**
 * Agent view & risk for one stock. Pass `insight` to render it directly; otherwise it fetches
 * /api/stock-insight lazily the first time it is opened.
 */
export function StockInsightPanel({
  symbol,
  insight,
  defaultOpen = false,
  compact = false,
  title = "Agent view & risk",
}: {
  symbol: string;
  insight?: InsightData;
  defaultOpen?: boolean;
  compact?: boolean;
  title?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [data, setData] = useState<InsightData | null>(insight ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const started = useRef(false);

  const load = useCallback(() => {
    if (started.current || insight) return;
    started.current = true;
    setLoading(true);
    fetch(`/api/stock-insight?symbol=${encodeURIComponent(symbol)}`)
      .then(async (res) => {
        if (res.status === 401) {
          window.location.replace("/login");
          return null;
        }
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((json as { error?: string }).error || `HTTP ${res.status}`);
        return json as StockInsight;
      })
      .then((j) => j && setData(j))
      .catch((e) => {
        started.current = false;
        setError(e instanceof Error ? e.message : "Could not load insight");
      })
      .finally(() => setLoading(false));
  }, [symbol, insight]);

  // Open-by-default panels fetch once on mount (deferred so state isn't set synchronously in the effect).
  useEffect(() => {
    if (!defaultOpen) return;
    const id = window.setTimeout(load, 0);
    return () => window.clearTimeout(id);
  }, [defaultOpen, load]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) load();
  };

  const shown = insight ?? data;
  return (
    <div className={clsx("rounded-xl border border-line", compact ? "p-2.5" : "p-3")}>
      <button type="button" onClick={toggle} aria-expanded={open} className="flex w-full items-center gap-2 text-left text-xs font-semibold">
        {open ? <ChevronDown className="h-4 w-4 text-muted" aria-hidden /> : <ChevronRight className="h-4 w-4 text-muted" aria-hidden />}
        <Bot className="h-4 w-4 text-[#a78bfa]" aria-hidden />
        <span className="flex-1">{title}</span>
        {shown && (
          <span className="flex items-center gap-1.5">
            <StanceChip stance={shown.verdict.stance} />
            <RiskChip level={shown.risk.level} />
          </span>
        )}
      </button>
      {open && (
        <div className="mt-3">
          {shown ? (
            <InsightBody data={shown} compact={compact} />
          ) : error ? (
            <p className="flex items-center gap-2 text-xs text-down">
              <AlertTriangle className="h-4 w-4" aria-hidden /> {error}
              <button type="button" onClick={load} className="text-accent hover:underline">
                Retry
              </button>
            </p>
          ) : (
            <p className="flex items-center gap-2 text-xs text-muted">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {loading ? "Analysing risk and verdict…" : "Loading…"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
