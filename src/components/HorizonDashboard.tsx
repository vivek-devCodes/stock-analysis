"use client";

import Link from "next/link";
import {
  AlertTriangle,
  CalendarClock,
  Crosshair,
  ExternalLink,
  Hourglass,
  Info,
  Loader2,
  Radar,
  RefreshCw,
  Scale,
  ShieldAlert,
  SlidersHorizontal,
  Target,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { clsx } from "@/lib/format";
import { MODE_INFO, MODES, type Mode, type ScreenPick, type ScreenResult } from "@/lib/modes";
import { NAV_ITEMS } from "@/lib/nav";
import { PageHeader } from "./shell/PageHeader";
import { TermLabel } from "./TermLabel";
import { TrackBadge } from "./TrackBadge";

const INITIAL_SHOWN = 10;

const ACTION_STYLE: Record<ScreenPick["action"], string> = {
  BUY: "bg-up/15 text-up",
  ACCUMULATE: "bg-up/15 text-up",
  CALL: "bg-up/15 text-up",
  SELL: "bg-down/15 text-down",
  AVOID: "bg-down/15 text-down",
  PUT: "bg-down/15 text-down",
  WAIT: "bg-white/10 text-muted",
};

const num = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const time = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

export function HorizonDashboard({ mode }: { mode: Mode }) {
  const info = MODE_INFO[mode];
  const navItem = NAV_ITEMS.find((n) => n.href === `/dashboard/${mode}`) ?? NAV_ITEMS[0];
  const [data, setData] = useState<ScreenResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sector, setSector] = useState("All");

  const fetchScreen = useCallback(
    async (force: boolean) => {
      const res = await fetch(`/api/screener?mode=${mode}${force ? "&refresh=1" : ""}`);
      if (res.status === 401) {
        window.location.replace("/login");
        return null;
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Scan failed");
      return json as ScreenResult;
    },
    [mode],
  );

  const apply = useCallback((promise: Promise<ScreenResult | null>, isCancelled: () => boolean = () => false) => {
    promise
      .then((result) => {
        if (isCancelled() || !result) return;
        setData(result);
        setError(null);
      })
      .catch((err) => {
        if (!isCancelled()) setError(err instanceof Error ? err.message : "Scan failed");
      })
      .finally(() => {
        if (!isCancelled()) setLoading(false);
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;
    apply(fetchScreen(false), isCancelled);
    const id = info.refreshMs
      ? window.setInterval(() => {
          if (document.visibilityState === "visible") apply(fetchScreen(false), isCancelled);
        }, info.refreshMs)
      : undefined;
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [apply, fetchScreen, info.refreshMs]);

  const refresh = () => {
    setLoading(true);
    apply(fetchScreen(true));
  };

  const sectors = useMemo(() => ["All", ...new Set((data?.picks ?? []).map((p) => p.sector))], [data]);
  const groups = useMemo(() => {
    const picks = (data?.picks ?? []).filter((p) => sector === "All" || p.sector === sector);
    return {
      bull: picks.filter((p) => p.bias === "bullish").sort((a, b) => b.score - a.score),
      bear: picks.filter((p) => p.bias === "bearish").sort((a, b) => a.score - b.score),
      neutral: picks.filter((p) => p.bias === "neutral").sort((a, b) => Math.abs(b.score) - Math.abs(a.score)),
    };
  }, [data, sector]);

  return (
    <div>
      <main className="space-y-4 p-4 sm:p-6">
        <PageHeader
          icon={navItem.icon}
          tone={navItem.tone}
          title={info.title}
          subtitle={`${info.horizon} · ${info.timeframe}`}
          actions={
            <>
              <label className="relative">
                <SlidersHorizontal className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" />
                <select
                  value={sector}
                  onChange={(e) => setSector(e.target.value)}
                  aria-label="Filter by sector"
                  className="rounded-xl border border-line bg-card py-2 pl-9 pr-3 text-sm"
                >
                  {sectors.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <button
                onClick={refresh}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-xl border border-line bg-card px-3 py-2 text-sm hover:bg-white/5 disabled:opacity-50"
              >
                <RefreshCw className={clsx("h-4 w-4", loading && "animate-spin")} />
                Refresh
              </button>
            </>
          }
        >
          <nav className="flex flex-wrap gap-2" aria-label="Trading desks">
            {MODES.map((m) => {
              const item = NAV_ITEMS.find((n) => n.href === `/dashboard/${m}`)!;
              const Icon = item.icon;
              return (
                <Link
                  key={m}
                  href={`/dashboard/${m}`}
                  aria-current={m === mode ? "page" : undefined}
                  className={clsx(
                    "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-xs",
                    m === mode ? "border-accent bg-accent/15 text-accent" : "border-line text-muted hover:text-foreground",
                  )}
                >
                  <Icon className={clsx("h-3.5 w-3.5", m === mode ? "" : item.tone)} />[ {MODE_INFO[m].label} ]
                </Link>
              );
            })}
          </nav>
        </PageHeader>

        {data && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat icon={TrendingUp} tone="text-up" label={info.bullTitle} value={groups.bull.length} />
            <Stat icon={TrendingDown} tone="text-down" label={info.bearTitle} value={groups.bear.length} />
            <Stat icon={Hourglass} tone="text-muted" label="No clear setup" value={groups.neutral.length} />
            <Stat icon={Radar} tone="text-accent" label="Stocks scanned" value={`${data.scanned - data.failed}/${data.scanned}`} />
          </div>
        )}
        {data && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="h-3.5 w-3.5" /> Updated {time(data.asOf)} IST
            </span>
            {data.dataAsOf && <span>Latest candle {time(data.dataAsOf)} IST</span>}
            {info.refreshMs > 0 && <span>Auto-refresh every {info.refreshMs / 60000} min</span>}
          </div>
        )}
        {data?.notes.map((note) => (
          <p key={note} className="flex items-start gap-2 rounded-lg border border-line bg-card px-3 py-2 text-xs text-muted">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {note}
          </p>
        ))}
        {error && (
          <p className="panel flex items-center gap-2 border-down/40 p-3 text-sm text-down">
            <AlertTriangle className="h-4 w-4" /> {error}
          </p>
        )}

        {!data && loading && (
          <div className="panel flex items-center gap-3 p-6 text-sm text-muted">
            <Loader2 className="h-5 w-5 animate-spin" />
            Scanning NSE stocks for {info.label.toLowerCase()} setups… the first scan takes up to 30 seconds.
          </div>
        )}

        {data && (
          <>
            <div className="grid gap-4 lg:grid-cols-2">
              <PickColumn title={info.bullTitle} picks={groups.bull} bullish />
              <PickColumn title={info.bearTitle} picks={groups.bear} bullish={false} />
            </div>
            <NeutralList picks={groups.neutral} />
          </>
        )}
      </main>
    </div>
  );
}

function PickColumn({ title, picks, bullish }: { title: string; picks: ScreenPick[]; bullish: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const Icon = bullish ? TrendingUp : TrendingDown;
  const shown = showAll ? picks : picks.slice(0, INITIAL_SHOWN);
  return (
    <section className="space-y-3">
      <h2 className={clsx("flex items-center gap-2 text-sm font-semibold uppercase tracking-wider", bullish ? "text-up" : "text-down")}>
        <Icon className="h-4 w-4" />
        {title} <span className="text-muted">({picks.length})</span>
      </h2>
      {picks.length === 0 && <p className="panel p-4 text-sm text-muted">No setups right now.</p>}
      {shown.map((p) => (
        <PickCard key={p.symbol} pick={p} />
      ))}
      {picks.length > INITIAL_SHOWN && (
        <button onClick={() => setShowAll((v) => !v)} className="text-xs text-accent hover:underline">
          {showAll ? "Show fewer" : `Show all ${picks.length}`}
        </button>
      )}
    </section>
  );
}

function PickCard({ pick: p }: { pick: ScreenPick }) {
  const rr =
    p.target != null && p.stop != null && p.entry !== p.stop
      ? Math.abs(p.target - p.entry) / Math.abs(p.entry - p.stop)
      : null;
  return (
    <article className="panel space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{p.symbol.replace(/\.NS$/, "")}</span>
            <span className={clsx("rounded px-2 py-0.5 text-[11px] font-bold", ACTION_STYLE[p.action])}>{p.action}</span>
            <span className="text-[11px] text-muted">score {p.score > 0 ? `+${p.score}` : p.score}</span>
            {p.action !== "WAIT" && <TrackBadge track={p.track} />}
          </div>
          <p className="truncate text-xs text-muted">
            {p.name} · {p.sector}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono text-sm font-semibold">{num(p.price)}</p>
          <p className={clsx("text-xs", p.changePercent >= 0 ? "text-up" : "text-down")}>
            {p.changePercent >= 0 ? "+" : ""}
            {p.changePercent.toFixed(2)}%
          </p>
        </div>
      </div>

      {p.option && (
        <p className="rounded-lg border border-[#b18cff]/40 bg-[#b18cff]/10 px-3 py-2 font-mono text-sm text-[#cdb6ff]">
          {p.symbol.startsWith("^") ? p.name.toUpperCase() : p.symbol.replace(/\.NS$/, "")} {p.option.strike.toLocaleString("en-IN")}{" "}
          {p.option.type} <span className="text-xs text-muted">· {p.option.expiry}</span>
        </p>
      )}

      {(p.target != null || p.stop != null) && (
        <div className="grid grid-cols-4 gap-2 text-xs">
          <Level icon={Crosshair} label="Entry" value={num(p.entry)} />
          <Level icon={Target} label={p.targetLabel} value={p.target != null ? num(p.target) : "—"} className="text-up" />
          <Level icon={ShieldAlert} label={p.stopLabel} value={p.stop != null ? num(p.stop) : "—"} className="text-down" />
          <Level icon={Scale} label="Reward : risk" value={rr != null ? `${rr.toFixed(1)} : 1` : "—"} />
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {p.metrics.map((m) => (
          <span key={m.label} className="rounded-md bg-white/5 px-2 py-1 text-[11px]">
            <TermLabel label={m.label} className="text-muted" />{" "}
            <span className={clsx(m.tone === "up" && "text-up", m.tone === "down" && "text-down", m.tone === "warn" && "text-warn")}>
              {m.value}
            </span>
          </span>
        ))}
      </div>

      {p.reasons.length > 0 && (
        <ul className="space-y-0.5 text-xs text-foreground/80">
          {p.reasons.map((r) => (
            <li key={r}>• {r}</li>
          ))}
        </ul>
      )}

      <Link
        href={`/analyze?symbol=${encodeURIComponent(p.symbol)}`}
        className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
      >
        Open full chart <ExternalLink className="h-3 w-3" />
      </Link>
    </article>
  );
}

function Stat({ icon: Icon, tone, label, value }: { icon: LucideIcon; tone: string; label: string; value: number | string }) {
  return (
    <div className="panel flex items-center gap-3 p-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/5">
        <Icon className={clsx("h-[18px] w-[18px]", tone)} />
      </span>
      <div className="min-w-0">
        <p className="font-mono text-lg font-semibold leading-tight">{value}</p>
        <p className="truncate text-[11px] text-muted">{label}</p>
      </div>
    </div>
  );
}

function Level({ icon: Icon, label, value, className }: { icon: LucideIcon; label: string; value: string; className?: string }) {
  return (
    <div className="rounded-lg bg-white/5 px-2 py-1.5">
      <p className="flex items-center gap-1 truncate text-[10px] text-muted">
        <Icon className="h-3 w-3 shrink-0" />
        {label}
      </p>
      <p className={clsx("font-mono", className)}>{value}</p>
    </div>
  );
}

function NeutralList({ picks }: { picks: ScreenPick[] }) {
  if (!picks.length) return null;
  return (
    <details className="panel p-4">
      <summary className="cursor-pointer text-sm font-semibold text-muted">No clear setup — wait ({picks.length})</summary>
      <div className="mt-3 flex flex-wrap gap-2">
        {picks.map((p) => (
          <Link
            key={p.symbol}
            href={`/analyze?symbol=${encodeURIComponent(p.symbol)}`}
            className="rounded-lg border border-line px-2 py-1 text-xs hover:bg-white/5"
          >
            {p.symbol.replace(/\.NS$/, "")}{" "}
            <span className={p.changePercent >= 0 ? "text-up" : "text-down"}>
              {p.changePercent >= 0 ? "+" : ""}
              {p.changePercent.toFixed(2)}%
            </span>
          </Link>
        ))}
      </div>
    </details>
  );
}
