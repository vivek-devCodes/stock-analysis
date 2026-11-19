"use client";

import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Circle,
  Clock,
  Crosshair,
  Database,
  ExternalLink,
  FileText,
  Gauge,
  Info,
  Layers,
  Link2,
  MinusCircle,
  Newspaper,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Sigma,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Users,
  XCircle,
  Minus,
} from "lucide-react";
import { clsx } from "@/lib/format";
import { AGENT_LABELS, HORIZONS, type AgentResult, type AnalysisReport, type Bias, type Validation } from "@/lib/agents/types";
import { Card } from "../shell/PageHeader";
import { TermLabel } from "../TermLabel";

const inr = (n: number | null | undefined, digits = 2) =>
  n == null || !Number.isFinite(n) ? "—" : n.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const pct = (x: number | null | undefined, digits = 1) => (x == null || !Number.isFinite(x) ? "—" : `${(x * 100).toFixed(digits)}%`);
const time = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) + " IST" : "—";

export const VALIDATION_STYLE: Record<Validation, string> = {
  APPROVED: "bg-up/15 text-up border-up/40",
  "APPROVED WITH CONDITIONS": "bg-warn/15 text-warn border-warn/40",
  "NO TRADE": "bg-white/8 text-foreground/80 border-line",
  "INSUFFICIENT DATA": "bg-white/8 text-muted border-line",
  REJECTED: "bg-down/15 text-down border-down/40",
};

export function ValidationBadge({ v }: { v: Validation }) {
  return <span className={clsx("inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold", VALIDATION_STYLE[v])}>{v}</span>;
}

function BiasTag({ bias }: { bias: Bias | null }) {
  if (!bias) return <span className="text-[11px] text-muted">no bias</span>;
  const Icon = bias === "bullish" ? TrendingUp : bias === "bearish" ? TrendingDown : Minus;
  return (
    <span className={clsx("inline-flex items-center gap-1 text-[11px] font-medium", bias === "bullish" ? "text-up" : bias === "bearish" ? "text-down" : "text-muted")}>
      <Icon className="h-3 w-3" />
      {bias}
    </span>
  );
}

function CheckIcon({ status }: { status: "pass" | "warn" | "fail" | "n/a" }) {
  if (status === "pass") return <CheckCircle2 className="h-4 w-4 shrink-0 text-up" aria-label="pass" />;
  if (status === "warn") return <AlertTriangle className="h-4 w-4 shrink-0 text-warn" aria-label="warning" />;
  if (status === "fail") return <XCircle className="h-4 w-4 shrink-0 text-down" aria-label="fail" />;
  return <MinusCircle className="h-4 w-4 shrink-0 text-muted" aria-label="not applicable" />;
}

function CheckList({ checks }: { checks: Array<{ name: string; status: "pass" | "warn" | "fail" | "n/a"; detail: string }> }) {
  if (!checks.length) return <p className="text-xs text-muted">No checks recorded.</p>;
  return (
    <ul className="divide-y divide-line/60">
      {checks.map((c) => (
        <li key={c.name} className="flex items-start gap-2 py-2 text-sm">
          <CheckIcon status={c.status} />
          <div className="min-w-0">
            <p className="font-medium">{c.name}</p>
            <p className="break-words text-xs text-muted">{c.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Tile({ label, value, tone, sub }: { label: string; value: string; tone?: "up" | "down" | "warn"; sub?: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-white/5 px-2.5 py-2">
      <p className="truncate text-[10px] uppercase tracking-wider text-muted">
        <TermLabel label={label} />
      </p>
      <p className={clsx("break-words font-mono text-sm", tone === "up" && "text-up", tone === "down" && "text-down", tone === "warn" && "text-warn")}>{value}</p>
      {sub && <p className="text-[10px] text-muted">{sub}</p>}
    </div>
  );
}

/* --------------------------- a. Executive summary --------------------------- */

function ExecutiveSummary({ r }: { r: AnalysisReport }) {
  const horizon = HORIZONS.find((h) => h.id === r.request.horizon)?.label ?? r.request.horizon;
  const noTrade = r.decision === "NO TRADE" || r.decision === "NO INVESTMENT";
  return (
    <section className="panel space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Executive summary</p>
          <h2 className="mt-1 break-words text-lg font-semibold">
            {r.instrument.name} <span className="text-sm font-normal text-muted">· {r.instrument.symbol} · {r.instrument.exchange}</span>
          </h2>
          <p className="text-xs text-muted">
            {r.instrument.sector} · {horizon} · regime: {r.marketRegime}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-xl font-semibold">
            {r.instrument.currency === "INR" ? "₹" : ""}
            {inr(r.price.value)}
          </p>
          <p className="text-[11px] text-muted">
            {time(r.price.timestamp)} · {r.price.source} · {r.price.marketOpen ? "market open" : "market closed"}
          </p>
        </div>
      </div>

      <div className={clsx("rounded-xl border p-4", noTrade ? "border-line bg-white/[0.03]" : r.decision === "BUY" ? "border-up/40 bg-up/5" : r.decision === "SELL" ? "border-down/40 bg-down/5" : "border-warn/40 bg-warn/5")}>
        <div className="flex flex-wrap items-center gap-3">
          <p className={clsx("text-3xl font-semibold tracking-tight", r.decision === "BUY" && "text-up", r.decision === "SELL" && "text-down", r.decision === "WATCHLIST" && "text-warn")}>{r.decision}</p>
          <ValidationBadge v={r.validation} />
          {noTrade && (
            <span className="inline-flex items-center gap-1 text-xs text-up">
              <ShieldCheck className="h-3.5 w-3.5" /> Valid outcome — capital protected
            </span>
          )}
        </div>
        <p className="mt-2 text-sm">{r.headline}</p>
        {noTrade && <p className="mt-1 text-xs text-muted">No suitable risk-adjusted opportunity was identified. Per the operating rules, this is a valid and successful system outcome.</p>}
        {!r.executable && (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-white/5 px-2 py-1 text-xs text-muted">
            <Ban className="h-3.5 w-3.5" /> Not an executable order — research output only.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="Score" value={r.score.total == null ? "—" : `${r.score.total}/100`} sub={r.score.band} />
        <Tile label="Coverage" value={pct(r.score.coverage, 0)} sub="share of weight with real data" />
        <Tile label="Data quality" value={r.dataQuality} tone={r.dataQuality === "good" ? "up" : r.dataQuality === "poor" ? "down" : "warn"} />
        <Tile label="Version" value={r.version != null ? `v${r.version}` : "not saved"} sub={r.persisted ? (r.id ?? undefined) : "no database"} />
      </div>
    </section>
  );
}

/* ---------------------------- b. Agent consensus ---------------------------- */

function AgentCard({ a }: { a: AgentResult }) {
  const off = a.status !== "ok";
  return (
    <article className={clsx("panel space-y-2 p-4", off && "opacity-70")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{AGENT_LABELS[a.agent]}</h3>
          <p className={clsx("text-[11px]", a.status === "ok" ? "text-up" : a.status === "error" ? "text-down" : "text-muted")}>
            {a.status === "ok" ? "Analysis complete" : a.status === "error" ? "Error" : "Insufficient data"}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono text-lg font-semibold">{a.score == null ? "—" : a.score}</p>
          <BiasTag bias={a.bias} />
        </div>
      </div>
      <p className="break-words text-xs text-foreground/85">{a.summary}</p>
      {a.findings.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {a.findings.map((f) => (
            <span key={f.label} className="max-w-full break-words rounded-md bg-white/5 px-2 py-1 text-[11px]">
              <TermLabel label={f.label} className="text-muted" />{" "}
              <span className={clsx(f.tone === "up" && "text-up", f.tone === "down" && "text-down", f.tone === "warn" && "text-warn")}>{f.value}</span>
            </span>
          ))}
        </div>
      )}
      {a.evidence.length > 0 && (
        <ul className="space-y-0.5 text-xs text-foreground/80">
          {a.evidence.map((e) => (
            <li key={e} className="break-words">• {e}</li>
          ))}
        </ul>
      )}
      {a.warnings.length > 0 && (
        <ul className="space-y-0.5 text-xs text-warn">
          {a.warnings.map((w) => (
            <li key={w} className="flex items-start gap-1 break-words">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {w}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

/* ------------------------------- d. Trade plan ------------------------------ */

function TradePlanCard({ r }: { r: AnalysisReport }) {
  const p = r.risk.plan;
  if (!p) {
    return (
      <Card icon={Crosshair} title="Trade plan">
        <p className="flex items-center gap-2 text-sm text-muted">
          <Circle className="h-4 w-4" /> No trade plan — the setup did not produce a valid entry, stop and target.
        </p>
      </Card>
    );
  }
  return (
    <Card icon={Crosshair} title="Trade plan" tone="text-accent">
      {p.illustrativeSizing && (
        <p className="mb-3 flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Illustrative sizing — you did not set capital or risk per trade, so quantity and losses use example values (₹{inr(r.risk.capital, 0)} at {r.risk.riskPerTradePct}%).
        </p>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="Instrument" value={p.instrument} />
        <Tile label="Direction" value={p.direction.toUpperCase()} tone={p.direction === "long" ? "up" : "down"} />
        <Tile label="Entry range" value={`${inr(p.entryLow)} – ${inr(p.entryHigh)}`} />
        <Tile label="Stop loss" value={inr(p.stop)} tone="down" />
        {p.targets.slice(0, 3).map((t, i) => (
          <Tile key={i} label={`Target ${i + 1}`} value={inr(t)} tone="up" />
        ))}
        <Tile label="Reward : risk" value={p.riskReward == null ? "—" : `${p.riskReward.toFixed(2)} : 1`} />
        <Tile label="Quantity" value={p.quantity.toLocaleString("en-IN")} />
        <Tile label="Capital required" value={`₹${inr(p.capitalRequired, 0)}`} />
        <Tile label="Max loss" value={`₹${inr(p.maxLoss, 0)}`} tone="down" />
        <Tile label="Estimated costs" value={`₹${inr(p.estimatedCosts, 0)}`} />
        <Tile label="Holding period" value={p.holdingPeriod} />
      </div>
      <div className="mt-3 space-y-1 text-xs">
        <p>
          <span className="font-medium text-muted">Trigger: </span>
          {p.trigger}
        </p>
        <p>
          <span className="font-medium text-muted">Invalidation: </span>
          {p.invalidation}
        </p>
      </div>
    </Card>
  );
}

/* ----------------------------- f. Expected value ---------------------------- */

function ExpectedValuePanel({ r }: { r: AnalysisReport }) {
  const ev = r.expectedValue;
  const known = ev.probabilityType === "backtested";
  return (
    <Card icon={Sigma} title="Expected value" tone="text-[#fbbf24]">
      <p className={clsx("mb-3 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold", known ? "bg-accent/15 text-accent" : "bg-white/8 text-muted")}>
        <Database className="h-3.5 w-3.5" />
        {known ? "Backtested probability" : "Unknown — no validated probability"}
      </p>
      {known ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Tile label="Hit rate" value={pct(ev.pWin)} />
          <Tile label="Avg win" value={pct(ev.avgWinPct, 2)} tone="up" />
          <Tile label="Avg loss" value={pct(ev.avgLossPct, 2)} tone="down" />
          <Tile label="Per trade, after costs" value={pct(ev.expectancyPct, 2)} tone={(ev.expectancyPct ?? 0) > 0 ? "up" : "down"} />
          <Tile label="Costs" value={pct(ev.costsPct, 2)} sub="round trip" />
          <Tile label="Samples" value={ev.samples.toLocaleString("en-IN")} sub={ev.period ?? undefined} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Tile label="Costs" value={pct(ev.costsPct, 2)} sub="round trip" />
          <Tile label="Samples" value={ev.samples ? ev.samples.toLocaleString("en-IN") : "none"} />
        </div>
      )}
      <p className="mt-3 break-words text-xs text-muted">{ev.note}</p>
    </Card>
  );
}

/* --------------------------------- full view -------------------------------- */

export function ReportView({ r }: { r: AnalysisReport }) {
  return (
    <div className="space-y-4">
      <ExecutiveSummary r={r} />

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
          <Users className="h-4 w-4 text-[#a78bfa]" /> Agent consensus
        </h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {r.agents.map((a) => (
            <AgentCard key={a.agent} a={a} />
          ))}
        </div>
      </section>

      <Card icon={Layers} title="Conflicts between agents" tone="text-warn">
        {r.conflicts.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted">
            <CheckCircle2 className="h-4 w-4 text-up" /> No conflicting conclusions.
          </p>
        ) : (
          <ul className="space-y-2">
            {r.conflicts.map((c, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <AlertTriangle className={clsx("mt-0.5 h-4 w-4 shrink-0", c.severity === "material" ? "text-down" : "text-warn")} />
                <span className="min-w-0 break-words">
                  <span className="font-medium">
                    {AGENT_LABELS[c.between[0]]} vs {AGENT_LABELS[c.between[1]]}
                  </span>{" "}
                  <span className="text-[10px] uppercase text-muted">({c.severity})</span> — {c.description}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <TradePlanCard r={r} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card icon={ShieldAlert} title={`Risk management · ${r.risk.approved ? "approved" : "not approved"}`} tone={r.risk.approved ? "text-up" : "text-down"}>
          <p className="mb-2 text-xs text-muted">
            Capital ₹{inr(r.risk.capital, 0)} · risk {r.risk.riskPerTradePct}% per trade{r.risk.illustrative ? " (illustrative)" : ""}
          </p>
          <CheckList checks={r.risk.checks} />
        </Card>
        <Card icon={Scale} title="Independent trade validator" tone="text-accent">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <ValidationBadge v={r.validator.verdict} />
            {r.validator.llmDowngraded && <span className="text-[11px] text-warn">Downgraded by the AI reviewer</span>}
          </div>
          <CheckList checks={r.validator.checks} />
          {r.validator.conditions.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold text-muted">Conditions</p>
              <ul className="mt-1 space-y-0.5 text-xs">
                {r.validator.conditions.map((c) => (
                  <li key={c} className="break-words">• {c}</li>
                ))}
              </ul>
            </div>
          )}
          {r.validator.llmConcerns.length > 0 && (
            <div className="mt-3">
              <p className="flex items-center gap-1 text-xs font-semibold text-muted">
                <Sparkles className="h-3.5 w-3.5" /> AI reviewer concerns
              </p>
              <ul className="mt-1 space-y-0.5 text-xs text-warn">
                {r.validator.llmConcerns.map((c) => (
                  <li key={c} className="break-words">• {c}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      <ExpectedValuePanel r={r} />

      <Card icon={Gauge} title="Scenarios">
        <div className="grid gap-3 md:grid-cols-3">
          {(
            [
              ["Bullish", r.scenarios.bull, "text-up", TrendingUp],
              ["Base", r.scenarios.base, "text-muted", Minus],
              ["Bearish", r.scenarios.bear, "text-down", TrendingDown],
            ] as const
          ).map(([label, text, tone, Icon]) => (
            <div key={label} className="rounded-lg bg-white/[0.03] p-3">
              <p className={clsx("flex items-center gap-1 text-xs font-semibold", tone)}>
                <Icon className="h-3.5 w-3.5" /> {label}
              </p>
              <p className="mt-1 break-words text-xs text-foreground/85">{text}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card icon={Newspaper} title="News & events" tone="text-[#f472b6]">
        {r.news.length === 0 ? (
          <p className="text-sm text-muted">No relevant news found for this stock.</p>
        ) : (
          <ul className="space-y-2">
            {r.news.map((n, i) => (
              <li key={`${n.url}-${i}`} className="flex gap-2">
                <span className={clsx("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.sentiment === "positive" ? "bg-up" : n.sentiment === "negative" ? "bg-down" : "bg-muted")} title={n.sentiment} />
                <div className="min-w-0">
                  <a href={n.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-start gap-1 break-words text-sm hover:text-accent">
                    {n.headline}
                    <ExternalLink className="mt-1 h-3 w-3 shrink-0 text-muted" />
                  </a>
                  <p className="text-[11px] text-muted">
                    {n.source} · {time(n.publishedAt)} · {n.sourceClass === "aggregator" ? "aggregator" : "media report"}
                    {n.stale && <span className="ml-1 rounded bg-warn/15 px-1 text-warn">stale</span>}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        icon={FileText}
        title="Analyst narrative"
        action={
          <span className={clsx("rounded px-1.5 py-0.5 text-[10px] font-semibold", r.narrativeBy === "gemini" ? "bg-accent/15 text-accent" : "bg-white/8 text-muted")}>
            {r.narrativeBy === "gemini" ? "Written by Gemini (older report)" : "Rule-based"}
          </span>
        }
      >
        <p className="whitespace-pre-line break-words text-sm leading-relaxed text-foreground/90">{r.narrative}</p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card icon={Link2} title="Sources & evidence">
          <ul className="space-y-1.5 text-xs">
            {r.sources.map((s, i) => (
              <li key={`${s.name}-${i}`} className="break-words">
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:text-accent">
                    {s.name}
                  </a>
                ) : (
                  <span className="font-medium">{s.name}</span>
                )}{" "}
                <span className="text-muted">
                  · {s.kind}
                  {s.timestamp ? ` · ${time(s.timestamp)}` : ""}
                  {s.note ? ` · ${s.note}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card icon={Clock} title="Pipeline stages">
          <ul className="space-y-1 text-xs">
            {r.stages.map((s) => (
              <li key={s.stage} className="flex items-start gap-2">
                <CheckIcon status={s.status === "done" ? "pass" : s.status === "failed" ? "fail" : "n/a"} />
                <span className="min-w-0 flex-1 break-words">
                  <span className="font-medium">{s.stage}</span> <span className="text-muted">— {s.detail}</span>
                </span>
                <span className="shrink-0 font-mono text-muted">{s.ms} ms</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {r.disclaimers.length > 0 && (
        <section className="rounded-xl border border-line p-3 text-[11px] text-muted">
          <p className="mb-1 flex items-center gap-1 font-semibold">
            <Info className="h-3.5 w-3.5" /> Disclaimers
          </p>
          <ul className="space-y-0.5">
            {r.disclaimers.map((d) => (
              <li key={d} className="break-words">• {d}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

