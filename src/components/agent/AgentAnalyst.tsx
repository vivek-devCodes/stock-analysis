"use client";

import { AlertTriangle, Bot, CheckCircle2, ChevronRight, Circle, Database, History, Inbox, Loader2, Play, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { clsx } from "@/lib/format";
import { HORIZONS, type AnalysisReport, type Decision, type Horizon, type RecommendationRow, type Validation } from "@/lib/agents/types";
import type { SearchResult } from "@/lib/types";
import { Card, PageHeader } from "../shell/PageHeader";
import { ReportView, ValidationBadge } from "./ReportView";
import { RulesPanel, ScanPanel } from "./ScanPanel";

const PIPELINE = [
  "Data validation",
  "Market context",
  "Specialist agents",
  "Conflict detection",
  "Expected value",
  "Risk approval",
  "Independent validation",
  "Final decision",
];

type HistoryResponse = { persisted: boolean; note?: string; rows: RecommendationRow[] };
type VersionRow = { version: number; createdAt: string; decision: Decision; validation: Validation; score: number | null };

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

async function readJson(res: Response) {
  if (res.status === 401) {
    window.location.replace("/login");
    return null;
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error || `Request failed (HTTP ${res.status})`);
  return json;
}

export function AgentAnalyst({ initialSymbol = "", initialHorizon = "swing", autoRun = false }: { initialSymbol?: string; initialHorizon?: Horizon; autoRun?: boolean } = {}) {
  const [symbol, setSymbol] = useState(initialSymbol);
  const [horizon, setHorizon] = useState<Horizon>(initialHorizon);
  const [capital, setCapital] = useState("");
  const [riskPct, setRiskPct] = useState("");
  const [suggest, setSuggest] = useState<SearchResult[]>([]);
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const searchTimer = useRef<number | null>(null);
  const stepTimer = useRef<number | null>(null);

  const loadHistory = useCallback(() => {
    fetch("/api/agent/recommendations")
      .then(readJson)
      .then((j) => {
        if (j) {
          setHistory(j as HistoryResponse);
          setHistoryError(null);
        }
      })
      .catch((e) => setHistoryError(e instanceof Error ? e.message : "Could not load history"));
  }, []);

  useEffect(() => {
    loadHistory();
    return () => {
      if (searchTimer.current) window.clearTimeout(searchTimer.current);
      if (stepTimer.current) window.clearInterval(stepTimer.current);
    };
  }, [loadHistory]);

  const onSymbolChange = (value: string) => {
    setSymbol(value);
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    if (value.trim().length < 2) {
      setSuggest([]);
      return;
    }
    searchTimer.current = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(value)}`);
        const json = await res.json();
        setSuggest((json.results ?? []).slice(0, 6));
      } catch {
        setSuggest([]);
      }
    }, 250);
  };

  const analyse = useCallback(async (rawSymbol: string, h: Horizon, cap: string, risk: string) => {
    const sym = rawSymbol.trim().toUpperCase();
    if (!sym) return;
    setSuggest([]);
    setRunning(true);
    setError(null);
    setReport(null);
    setVersions(null);
    setStep(0);
    // Purely visual progress until the single response arrives.
    stepTimer.current = window.setInterval(() => setStep((s) => Math.min(s + 1, PIPELINE.length - 1)), 3500);
    try {
      const body: Record<string, unknown> = { symbol: sym, horizon: h };
      const capN = Number(cap);
      const riskN = Number(risk);
      if (cap.trim() && Number.isFinite(capN) && capN > 0) body.capital = capN;
      if (risk.trim() && Number.isFinite(riskN) && riskN > 0) body.riskPct = riskN;
      const res = await fetch("/api/agent/analyse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await readJson(res);
      if (json) {
        setReport(json as AnalysisReport);
        loadHistory();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      if (stepTimer.current) window.clearInterval(stepTimer.current);
      setRunning(false);
    }
  }, [loadHistory]);

  const run = (e: FormEvent) => {
    e.preventDefault();
    void analyse(symbol, horizon, capital, riskPct);
  };

  // /agent?symbol=TCS.NS&horizon=swing — prefilled from the URL and run once (deferred, not set synchronously in the effect).
  const autoRan = useRef(false);
  useEffect(() => {
    if (!autoRun || !initialSymbol || autoRan.current) return;
    autoRan.current = true;
    const id = window.setTimeout(() => void analyse(initialSymbol, initialHorizon, "", ""), 0);
    return () => window.clearTimeout(id);
  }, [autoRun, initialSymbol, initialHorizon, analyse]);

  const openHistory = async (id: string) => {
    setError(null);
    setReport(null);
    setVersions(null);
    try {
      const json = await readJson(await fetch(`/api/agent/recommendations/${encodeURIComponent(id)}`));
      if (json) {
        setReport((json as { report: AnalysisReport }).report);
        setVersions((json as { versions: VersionRow[] }).versions ?? []);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load recommendation");
    }
  };

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <PageHeader
        icon={Bot}
        tone="text-[#a78bfa]"
        title="AI Analyst"
        subtitle="Multi-agent analysis — specialist agents, conflict checks, risk approval and an independent validator. “NO TRADE” is a valid outcome."
      />

      <form onSubmit={run} className="panel space-y-4 p-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <label className="relative block space-y-1">
            <span className="text-xs text-muted">Stock or index</span>
            <span className="relative block">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" />
              <input
                value={symbol}
                onChange={(e) => onSymbolChange(e.target.value)}
                onBlur={() => window.setTimeout(() => setSuggest([]), 150)}
                placeholder="e.g. RELIANCE, TCS.NS, HDFCBANK"
                autoComplete="off"
                required
                className="w-full rounded-xl border border-line bg-card py-2 pl-9 pr-3 text-sm outline-none ring-accent/40 focus:ring-2"
              />
            </span>
            {suggest.length > 0 && (
              <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-line bg-[#121821] shadow-2xl">
                {suggest.map((s) => (
                  <button
                    key={s.symbol}
                    type="button"
                    onMouseDown={(ev) => ev.preventDefault()}
                    onClick={() => {
                      setSymbol(s.symbol);
                      setSuggest([]);
                    }}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-white/5"
                  >
                    <span className="min-w-0 truncate">
                      <span className="font-semibold">{s.symbol}</span> <span className="text-xs text-muted">{s.name}</span>
                    </span>
                    <span className="shrink-0 text-[10px] text-muted">{s.exchange}</span>
                  </button>
                ))}
              </div>
            )}
          </label>
          <fieldset className="space-y-1">
            <legend className="text-xs text-muted">Horizon</legend>
            <div className="flex flex-wrap gap-1 rounded-xl border border-line bg-card p-1">
              {HORIZONS.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  title={h.hint}
                  aria-pressed={horizon === h.id}
                  onClick={() => setHorizon(h.id)}
                  className={clsx("rounded-lg px-3 py-1.5 text-xs", horizon === h.id ? "bg-accent text-white" : "text-muted hover:text-foreground")}
                >
                  {h.label}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
        <p className="text-[11px] text-muted">{HORIZONS.find((h) => h.id === horizon)?.hint}</p>

        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1">
            <span className="block text-xs text-muted">Capital (₹, optional)</span>
            <input
              inputMode="decimal"
              value={capital}
              onChange={(e) => setCapital(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="100000"
              className="w-36 rounded-xl border border-line bg-card px-3 py-2 text-sm"
            />
          </label>
          <label className="space-y-1">
            <span className="block text-xs text-muted">Risk per trade (%, optional)</span>
            <input
              inputMode="decimal"
              value={riskPct}
              onChange={(e) => setRiskPct(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="1"
              className="w-28 rounded-xl border border-line bg-card px-3 py-2 text-sm"
            />
          </label>
          <button
            type="submit"
            disabled={running || !symbol.trim()}
            className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-50"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {running ? "Analysing…" : "Run analysis"}
          </button>
        </div>
        <p className="text-[11px] text-muted">
          Without capital and risk, position sizing is illustrative (₹1,00,000 at 1% risk per trade) and clearly marked as an example.
        </p>
      </form>

      {running && (
        <Card icon={Loader2} title="Running pipeline" tone="text-accent animate-spin">
          <ol className="grid gap-1.5 sm:grid-cols-2">
            {PIPELINE.map((s, i) => (
              <li key={s} className="flex items-center gap-2 text-sm">
                {i < step ? (
                  <CheckCircle2 className="h-4 w-4 text-up" />
                ) : i === step ? (
                  <Loader2 className="h-4 w-4 animate-spin text-accent" />
                ) : (
                  <Circle className="h-4 w-4 text-muted" />
                )}
                <span className={clsx(i > step && "text-muted")}>
                  Stage {i + 1}: {s}
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-[11px] text-muted">Usually takes 10–40 seconds. Progress is indicative until the result arrives.</p>
        </Card>
      )}

      {error && (
        <p className="panel flex items-center gap-2 border-down/40 p-3 text-sm text-down">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      {versions && versions.length > 0 && (
        <Card icon={History} title="Version history (this recommendation)">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-xs">
              <thead>
                <tr className="border-b border-line text-left text-muted">
                  <th className="px-2 py-1.5 font-medium">Version</th>
                  <th className="px-2 py-1.5 font-medium">Created</th>
                  <th className="px-2 py-1.5 font-medium">Decision</th>
                  <th className="px-2 py-1.5 font-medium">Validation</th>
                  <th className="px-2 py-1.5 text-right font-medium">Score</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.version} className="border-b border-line/60">
                    <td className="px-2 py-1.5 font-mono">v{v.version}</td>
                    <td className="px-2 py-1.5">{when(v.createdAt)}</td>
                    <td className="px-2 py-1.5 font-semibold">{v.decision}</td>
                    <td className="px-2 py-1.5">
                      <ValidationBadge v={v.validation} />
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono">{v.score ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {report && <ReportView r={report} />}

      <ScanPanel />

      <RulesPanel />

      <Card
        icon={History}
        title="Recommendation history"
        action={
          <button onClick={loadHistory} className="text-xs text-accent hover:underline">
            Refresh
          </button>
        }
      >
        {historyError ? (
          <p className="flex items-center gap-2 text-sm text-down">
            <AlertTriangle className="h-4 w-4" /> {historyError}
          </p>
        ) : !history ? (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        ) : !history.persisted ? (
          <p className="flex items-start gap-2 text-sm text-muted">
            <Database className="mt-0.5 h-4 w-4 shrink-0" />
            {history.note ?? "Connect a Postgres database (DATABASE_URL) to keep recommendation history."}
          </p>
        ) : history.rows.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Inbox className="h-4 w-4" /> No analyses saved yet. Run one above.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-xs">
              <thead>
                <tr className="border-b border-line text-left text-muted">
                  <th className="px-2 py-1.5 font-medium">Symbol</th>
                  <th className="px-2 py-1.5 font-medium">Horizon</th>
                  <th className="px-2 py-1.5 font-medium">Decision</th>
                  <th className="px-2 py-1.5 font-medium">Validation</th>
                  <th className="px-2 py-1.5 text-right font-medium">Score</th>
                  <th className="px-2 py-1.5 text-right font-medium">Versions</th>
                  <th className="px-2 py-1.5 font-medium">Status</th>
                  <th className="px-2 py-1.5 text-right font-medium">Outcome</th>
                  <th className="px-2 py-1.5 font-medium">Updated</th>
                  <th className="px-2 py-1.5" aria-label="Open" />
                </tr>
              </thead>
              <tbody>
                {history.rows.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => openHistory(r.id)}
                    className="cursor-pointer border-b border-line/60 hover:bg-white/[0.03]"
                  >
                    <td className="px-2 py-1.5 font-semibold">
                      <button type="button" onClick={(ev) => { ev.stopPropagation(); void openHistory(r.id); }} className="hover:text-accent">
                        {r.symbol.replace(/\.NS$/, "")}
                      </button>
                    </td>
                    <td className="px-2 py-1.5">{HORIZONS.find((h) => h.id === r.horizon)?.label ?? r.horizon}</td>
                    <td className="px-2 py-1.5 font-semibold">{r.decision}</td>
                    <td className="px-2 py-1.5">
                      <ValidationBadge v={r.validation} />
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono">{r.score ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{r.versions}</td>
                    <td className="px-2 py-1.5">{r.status}</td>
                    <td className={clsx("px-2 py-1.5 text-right font-mono", (r.outcomeReturnPct ?? 0) > 0 && "text-up", (r.outcomeReturnPct ?? 0) < 0 && "text-down")}>
                      {r.outcomeReturnPct == null ? "—" : `${r.outcomeReturnPct >= 0 ? "+" : ""}${r.outcomeReturnPct.toFixed(2)}%`}
                    </td>
                    <td className="px-2 py-1.5">{when(r.updatedAt)}</td>
                    <td className="px-2 py-1.5 text-muted">
                      <ChevronRight className="h-4 w-4" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
