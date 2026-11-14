"use client";

import Link from "next/link";
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, Bot, Check, ChevronDown, ChevronRight, Info, Loader2, Minus, PieChart, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { clsx } from "@/lib/format";
import type { Returns, SectorDetailResponse, SectorStock, SectorSummary, SectorsResponse } from "@/lib/insights/types";
import { InsightBody, RiskChip, StanceChip } from "../insights/StockInsightPanel";
import { Card, PageHeader } from "../shell/PageHeader";

type Period = keyof Returns;
const PERIODS: Array<{ id: Period; label: string }> = [
  { id: "d1", label: "Today" },
  { id: "m1", label: "1M" },
  { id: "m2", label: "2M" },
  { id: "m3", label: "3M" },
];
const PROXY_NOTE = "Price-volume proxy (up-day vs down-day volume over 20 sessions) — not actual FII/DII flows.";

const pct = (x: number | null | undefined, d = 1) => (x == null || !Number.isFinite(x) ? "—" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)}%`);
const tone = (x: number | null | undefined) => (x == null ? "text-muted" : x > 0 ? "text-up" : x < 0 ? "text-down" : "text-muted");
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

function PressureBadge({ p, ratio }: { p: SectorSummary["pressure"]; ratio: number | null }) {
  const Icon = p === "buying" ? TrendingUp : p === "selling" ? TrendingDown : Minus;
  return (
    <span
      title={`${PROXY_NOTE}${ratio != null ? ` Ratio ${ratio.toFixed(2)}.` : ""}`}
      className={clsx(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold",
        p === "buying" ? "bg-up/15 text-up" : p === "selling" ? "bg-down/15 text-down" : "bg-white/8 text-muted",
      )}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {p === "buying" ? "Buying" : p === "selling" ? "Selling" : "Neutral"}
    </span>
  );
}

/* ----------------------------------------- overview ----------------------------------------- */

function SectorCard({ s, period }: { s: SectorSummary; period: Period }) {
  const main = s.index?.[period] ?? s.avg[period];
  const positive = (main ?? 0) >= 0;
  return (
    <Link
      href={`/sectors?sector=${encodeURIComponent(s.sector)}`}
      className={clsx("panel group flex flex-col gap-3 p-4 transition-colors hover:border-white/20", positive ? "border-l-2 border-l-up/60" : "border-l-2 border-l-down/60")}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold">{s.label}</p>
          <p className="text-[11px] text-muted">
            {s.stocks} stocks{s.indexSymbol ? ` · ${s.indexSymbol}` : ""}
          </p>
        </div>
        <PressureBadge p={s.pressure} ratio={s.upDownVolumeRatio} />
      </div>
      <p className={clsx("font-mono text-2xl font-semibold", tone(main))}>{pct(main)}</p>
      <div className="grid grid-cols-4 gap-1 text-center text-[11px]">
        {PERIODS.map((p) => (
          <div key={p.id} className={clsx("rounded-md px-1 py-1", p.id === period ? "bg-white/8" : "bg-white/[0.03]")}>
            <p className="text-[10px] text-muted">{p.label}</p>
            <p className={clsx("font-mono", tone(s.index?.[p.id] ?? s.avg[p.id]))}>{pct(s.index?.[p.id] ?? s.avg[p.id])}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
        <span>
          Today: <span className="text-up">{s.breadthToday.up}▲</span> <span className="text-down">{s.breadthToday.down}▼</span> {s.breadthToday.flat}•
        </span>
        <span>
          Profitable ({PERIODS.find((p) => p.id === period)?.label}): <span className="text-foreground">{s.profitableShare[period] == null ? "—" : `${Math.round((s.profitableShare[period] ?? 0) * 100)}%`}</span>
        </span>
        <span>Avg stock: <span className={tone(s.avg[period])}>{pct(s.avg[period])}</span></span>
      </div>
      <span className="mt-auto inline-flex items-center gap-1 text-xs text-accent">
        View companies <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

/* ------------------------------------------ detail ------------------------------------------ */

type SortKey = "symbol" | "d1" | "m1" | "m2" | "m3" | "fundamentalScore" | "stance" | "risk";
const STANCE_ORDER = { CONSIDER: 0, WATCH: 1, NEUTRAL: 2, AVOID: 3 } as const;
const RISK_ORDER = { LOW: 0, MEDIUM: 1, HIGH: 2 } as const;

function sortValue(s: SectorStock, k: SortKey): number | string | null {
  if (k === "symbol") return s.symbol;
  if (k === "fundamentalScore") return s.fundamentalScore;
  if (k === "stance") return STANCE_ORDER[s.verdict.stance];
  if (k === "risk") return RISK_ORDER[s.risk.level];
  return s.returns[k];
}

function ReturnCell({ v }: { v: number | null }) {
  return (
    <td className={clsx("px-2 py-2 text-right font-mono", tone(v))}>
      <span className="inline-flex items-center justify-end gap-1">
        {v != null && v > 0 && <Check className="h-3 w-3" aria-label="profitable" />}
        {pct(v)}
      </span>
    </td>
  );
}

function Th({ k, label, right = false, sort, onSort }: { k: SortKey; label: string; right?: boolean; sort: { key: SortKey; dir: 1 | -1 }; onSort: (k: SortKey) => void }) {
  return (
    <th className={clsx("px-2 py-2 font-medium", right ? "text-right" : "text-left")}>
      <button type="button" onClick={() => onSort(k)} className="inline-flex items-center gap-0.5 hover:text-foreground">
        {label}
        {sort.key === k && (sort.dir === -1 ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
      </button>
    </th>
  );
}

function SectorDetail({ data }: { data: SectorDetailResponse }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "m1", dir: -1 });
  const [open, setOpen] = useState<string | null>(null);
  const s = data.sector;
  const rows = useMemo(() => {
    return [...data.stocks].sort((a, b) => {
      const av = sortValue(a, sort.key);
      const bv = sortValue(b, sort.key);
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * sort.dir;
      return ((av as number) - (bv as number)) * sort.dir;
    });
  }, [data.stocks, sort]);
  const toggleSort = (key: SortKey) => setSort((p) => (p.key === key ? { key, dir: p.dir === 1 ? -1 : 1 } : { key, dir: key === "symbol" || key === "stance" || key === "risk" ? 1 : -1 }));
  const th = { sort, onSort: toggleSort };

  return (
    <div className="space-y-4">
      <Link href="/sectors" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> All sectors
      </Link>
      <div className="panel flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
        <div>
          <p className="text-lg font-semibold">{s.label}</p>
          <p className="text-xs text-muted">
            {s.stocks} stocks{s.indexSymbol ? ` · index ${s.indexSymbol}` : ""}
          </p>
        </div>
        {PERIODS.map((p) => (
          <div key={p.id}>
            <p className="text-[10px] text-muted">{p.label}</p>
            <p className={clsx("font-mono text-sm", tone(s.index?.[p.id] ?? s.avg[p.id]))}>{pct(s.index?.[p.id] ?? s.avg[p.id])}</p>
            <p className="text-[10px] text-muted">{s.profitableShare[p.id] == null ? "—" : `${Math.round((s.profitableShare[p.id] ?? 0) * 100)}% profitable`}</p>
          </div>
        ))}
        <div className="flex flex-col gap-1">
          <PressureBadge p={s.pressure} ratio={s.upDownVolumeRatio} />
          <p className="text-[10px] text-muted">{s.upDownVolumeRatio != null ? `up/down volume ${s.upDownVolumeRatio.toFixed(2)}` : ""}</p>
        </div>
      </div>

      <Card icon={PieChart} title="Companies" tone="text-[#34d399]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-xs">
            <thead>
              <tr className="border-b border-line text-muted">
                <th className="w-6 px-1" aria-label="Expand" />
                <Th {...th} k="symbol" label="Company" />
                <Th {...th} k="d1" label="Today" right />
                <Th {...th} k="m1" label="1M" right />
                <Th {...th} k="m2" label="2M" right />
                <Th {...th} k="m3" label="3M" right />
                <Th {...th} k="fundamentalScore" label="Fundamentals" right />
                <Th {...th} k="stance" label="Agent view" />
                <Th {...th} k="risk" label="Risk" />
                <th className="px-2 py-2 text-left font-medium">Analysis</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((st) => {
                const isOpen = open === st.symbol;
                return (
                  <Fragment key={st.symbol}>
                    <tr className="border-b border-line/60 hover:bg-white/[0.03]">
                      <td className="px-1 py-2">
                        <button type="button" aria-expanded={isOpen} aria-label={`${isOpen ? "Hide" : "Show"} details for ${short(st.symbol)}`} onClick={() => setOpen(isOpen ? null : st.symbol)} className="text-muted hover:text-foreground">
                          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                      </td>
                      <td className="px-2 py-2">
                        <Link href={`/analyze?symbol=${encodeURIComponent(st.symbol)}`} className="font-semibold hover:text-accent">
                          {short(st.symbol)}
                        </Link>
                        <p className="max-w-[220px] truncate text-[11px] text-muted">
                          {st.name}
                          {st.price != null ? ` · ${st.price.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : ""}
                        </p>
                      </td>
                      <ReturnCell v={st.returns.d1} />
                      <ReturnCell v={st.returns.m1} />
                      <ReturnCell v={st.returns.m2} />
                      <ReturnCell v={st.returns.m3} />
                      <td className="px-2 py-2 text-right font-mono">{st.fundamentalScore ?? "—"}</td>
                      <td className="px-2 py-2">
                        <StanceChip stance={st.verdict.stance} />
                      </td>
                      <td className="px-2 py-2">
                        <RiskChip level={st.risk.level} />
                      </td>
                      <td className="px-2 py-2">
                        <Link href={st.agentHref} className="inline-flex items-center gap-1 text-[#c4b5fd] hover:underline">
                          <Bot className="h-3.5 w-3.5" aria-hidden /> Full analysis
                        </Link>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-line/60 bg-white/[0.02]">
                        <td colSpan={10} className="px-3 py-3">
                          <InsightBody data={st} compact />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] text-muted">
          ✓ = profitable (positive return) over that window. &ldquo;Agent view&rdquo; is a quick screen — open the full analysis for the validated, risk-checked verdict.
        </p>
      </Card>
      <Notes notes={data.notes} />
    </div>
  );
}

function Notes({ notes }: { notes: string[] }) {
  return (
    <div className="space-y-1.5">
      {[PROXY_NOTE, ...notes.filter((n) => n !== PROXY_NOTE)].map((n) => (
        <p key={n} className="flex items-start gap-2 rounded-lg border border-line bg-card px-3 py-2 text-xs text-muted">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {n}
        </p>
      ))}
    </div>
  );
}

/* ------------------------------------------ module ------------------------------------------ */

export function SectorsModule({ initialSector }: { initialSector: string | null }) {
  const [overview, setOverview] = useState<SectorsResponse | null>(null);
  const [detail, setDetail] = useState<SectorDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>("d1");
  const [reload, setReload] = useState(0);

  const fetchData = useCallback(async () => {
    if (initialSector) return { detail: await readJson<SectorDetailResponse>(await fetch(`/api/sectors/${encodeURIComponent(initialSector)}`)) };
    return { overview: await readJson<SectorsResponse>(await fetch("/api/sectors")) };
  }, [initialSector]);

  useEffect(() => {
    let cancelled = false;
    fetchData()
      .then((r) => {
        if (cancelled) return;
        if (r.detail) setDetail(r.detail);
        if (r.overview) setOverview(r.overview);
        setError(null);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Could not load sectors"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [fetchData, reload]);

  const sorted = useMemo(
    () => [...(overview?.sectors ?? [])].sort((a, b) => ((b.index?.[period] ?? b.avg[period]) ?? -Infinity) - ((a.index?.[period] ?? a.avg[period]) ?? -Infinity)),
    [overview, period],
  );
  const positive = sorted.filter((s) => (s.index?.[period] ?? s.avg[period] ?? 0) >= 0).length;

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <PageHeader
        icon={PieChart}
        tone="text-[#34d399]"
        title={detail ? `Sector — ${detail.sector.label}` : "Sectors"}
        subtitle="Which sectors are rising or falling, where buying or selling pressure is, and how each company has done."
        actions={
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              setReload((n) => n + 1);
            }}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-line bg-card px-3 py-2 text-sm hover:bg-white/5 disabled:opacity-50"
          >
            <RefreshCw className={clsx("h-4 w-4", loading && "animate-spin")} /> Refresh
          </button>
        }
      />

      {error && (
        <p className="panel flex items-center gap-2 border-down/40 p-3 text-sm text-down">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </p>
      )}
      {loading && !overview && !detail && (
        <div className="panel flex items-center gap-3 p-6 text-sm text-muted">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading sector data… the first load can take up to 40 seconds.
        </div>
      )}

      {detail && <SectorDetail data={detail} />}

      {!initialSector && overview && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-1 rounded-xl border border-line bg-card p-1" role="group" aria-label="Period">
              {PERIODS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={period === p.id}
                  onClick={() => setPeriod(p.id)}
                  className={clsx("rounded-lg px-3 py-1.5 text-xs", period === p.id ? "bg-accent text-white" : "text-muted hover:text-foreground")}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted">
              <span className="text-up">{positive} positive</span> · <span className="text-down">{sorted.length - positive} negative</span> · sorted strongest → weakest
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {sorted.map((s) => (
              <SectorCard key={s.sector} s={s} period={period} />
            ))}
          </div>
          <Notes notes={overview.notes} />
        </>
      )}
    </div>
  );
}
