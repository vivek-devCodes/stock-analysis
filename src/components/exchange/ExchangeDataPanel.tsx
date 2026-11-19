"use client";

import { AlertTriangle, Building2, ChevronDown, ChevronRight, ExternalLink, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { DATASET, SHORT_PAGE } from "@/lib/exchange/catalog";
import type { ExchangeSignal, StockExchangeView } from "@/lib/exchange/types";
import { clsx } from "@/lib/format";

const EFFECT_STYLE: Record<ExchangeSignal["effect"], { dot: string; text: string; label: string }> = {
  bullish: { dot: "bg-up", text: "text-up", label: "Bullish" },
  bearish: { dot: "bg-down", text: "text-down", label: "Bearish" },
  risk: { dot: "bg-warn", text: "text-warn", label: "Risk" },
  info: { dot: "bg-muted", text: "text-muted", label: "Context" },
};

const lakh = (x: number) => (x >= 1e7 ? `${(x / 1e7).toFixed(1)} cr` : `${(x / 1e5).toFixed(1)} L`);
const num = (x: number | null | undefined, d = 2) => (x == null || !Number.isFinite(x) ? "—" : x.toLocaleString("en-IN", { maximumFractionDigits: d }));

function SourceLink({ source, tradeDate }: { source: ExchangeSignal["source"]; tradeDate: string | null }) {
  const spec = source in DATASET ? DATASET[source as keyof typeof DATASET] : null;
  const label = SHORT_PAGE[source];
  if (!spec || !tradeDate) return <span className="text-[10px] text-muted">{label}</span>;
  return (
    <a href={spec.url(tradeDate)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[10px] text-accent hover:underline" title={`${spec.page} — ${spec.file(tradeDate)}`}>
      {label}
      <ExternalLink className="h-2.5 w-2.5" aria-hidden />
    </a>
  );
}

function SignalRow({ s, tradeDate }: { s: ExchangeSignal; tradeDate: string | null }) {
  const st = EFFECT_STYLE[s.effect];
  return (
    <li className="flex gap-2 rounded-lg bg-white/3 px-2.5 py-2">
      <span className={clsx("mt-1.5 h-2 w-2 shrink-0 rounded-full", st.dot)} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <p className="text-sm font-medium">
            {s.label}
            {s.blocks?.length ? <span className="ml-1.5 rounded bg-down/15 px-1 py-0.5 text-[10px] font-bold text-down">blocks {s.blocks.join(", ")}</span> : null}
          </p>
          <p className={clsx("font-mono text-xs", st.text)}>{s.value}</p>
        </div>
        <p className="mt-0.5 text-xs text-muted">{s.detail}</p>
        <div className="mt-1">
          <SourceLink source={s.source} tradeDate={tradeDate} />
        </div>
      </div>
    </li>
  );
}

export function ExchangeDataPanel({ symbol }: { symbol: string }) {
  const [view, setView] = useState<StockExchangeView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSources, setShowSources] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/exchange/stock?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Exchange data unavailable");
        if (alive) setView(j as StockExchangeView);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [symbol]);

  if (error) return <section className="panel p-4 text-sm text-muted">Exchange data: {error}</section>;
  if (!view)
    return (
      <section className="panel flex items-center gap-2 p-4 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading NSE / BSE exchange data…
      </section>
    );

  const s = view.stock;
  const o = s?.fno ?? null;
  const risks = view.signals.filter((x) => x.effect === "risk");
  const direction = view.signals.filter((x) => x.effect === "bullish" || x.effect === "bearish");
  const context = view.signals.filter((x) => x.effect === "info");
  const bull = direction.filter((x) => x.effect === "bullish").length;
  const bear = direction.length - bull;
  const blocked = [...new Set(risks.flatMap((x) => x.blocks ?? []))];
  const maxOi = o ? Math.max(1, ...o.chain.flatMap(([, c, p]) => [c, p])) : 1;
  const maxDel = Math.max(1, ...view.history.map((h) => h.deliveryPct ?? 0));

  return (
    <section className="panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Building2 className="h-4 w-4 text-accent" aria-hidden /> Exchange data — what the agent uses
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            NSE / BSE official end-of-day files{view.tradeDate ? ` for the ${view.tradeDate} session` : ""}. Every point below is fed to the AI agents (direction evidence, risk vetoes) and to the
            next-session intraday plan.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          <span className="chip bg-up/15 text-up">{bull} bullish</span>
          <span className="chip bg-down/15 text-down">{bear} bearish</span>
          <span className="chip bg-warn/15 text-warn">{risks.length} risk</span>
        </div>
      </div>

      {view.note && <p className="mt-3 rounded-lg bg-white/4 px-3 py-2 text-xs text-muted">{view.note}</p>}
      {blocked.length > 0 && (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-down/30 bg-down/10 px-3 py-2 text-xs text-down">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          The agent will not recommend a {blocked.join(" / ")} trade in {s?.symbol ?? symbol}: {risks.filter((x) => x.blocks?.length).map((x) => x.label.toLowerCase()).join(", ")}.
        </p>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-warn">Risk &amp; restrictions</h3>
          <ul className="space-y-1.5">{risks.length ? risks.map((x) => <SignalRow key={x.id} s={x} tradeDate={view.tradeDate} />) : <li className="text-xs text-muted">No surveillance, circuit, ban or event risk found.</li>}</ul>
        </div>
        <div className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-accent">Direction evidence</h3>
          <ul className="space-y-1.5">{direction.length ? direction.map((x) => <SignalRow key={x.id} s={x} tradeDate={view.tradeDate} />) : <li className="text-xs text-muted">No directional signal from delivery, F&amp;O or deals in the last session.</li>}</ul>
        </div>
        <div className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Context</h3>
          <ul className="space-y-1.5">{context.map((x) => <SignalRow key={x.id} s={x} tradeDate={view.tradeDate} />)}</ul>
        </div>
      </div>

      {(o || view.history.length > 1 || s) && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {o && (
            <div className="rounded-lg border border-line p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                Option chain walls · expiry {o.expiry} ({o.daysToExpiry}d)
              </p>
              <div className="mt-2 space-y-1">
                {o.chain.map(([k, c, p]) => (
                  <div key={k} className="grid grid-cols-[1fr_64px_1fr] items-center gap-2 text-[11px]">
                    <div className="flex justify-end">
                      <div className="h-2 rounded-l bg-down/70" style={{ width: `${(c / maxOi) * 100}%` }} title={`Call OI ${lakh(c)}`} />
                    </div>
                    <p className={clsx("text-center font-mono", o.underlying != null && Math.abs(k - o.underlying) === Math.min(...o.chain.map(([x]) => Math.abs(x - (o.underlying ?? 0)))) && "font-bold text-accent")}>{num(k)}</p>
                    <div className="h-2 rounded-r bg-up/70" style={{ width: `${(p / maxOi) * 100}%` }} title={`Put OI ${lakh(p)}`} />
                  </div>
                ))}
              </div>
              <div className="mt-2 flex justify-between text-[10px] text-muted">
                <span>◀ call OI (resistance)</span>
                <span>put OI (support) ▶</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                {[
                  ["PCR", o.pcr?.toFixed(2) ?? "—"],
                  ["Max pain", num(o.maxPain)],
                  ["ATM IV", o.atmIv != null ? `${(o.atmIv * 100).toFixed(1)}%` : "—"],
                  ["Lot", num(o.lotSize, 0)],
                  ["Call Δ / Θ", o.atmCall ? `${o.atmCall.delta.toFixed(2)} / ${o.atmCall.theta.toFixed(2)}` : "—"],
                  ["Put Δ / Θ", o.atmPut ? `${o.atmPut.delta.toFixed(2)} / ${o.atmPut.theta.toFixed(2)}` : "—"],
                  ["Futures OI Δ", o.futOiChangePct != null ? `${o.futOiChangePct >= 0 ? "+" : ""}${o.futOiChangePct.toFixed(1)}%` : "—"],
                  ["Basis", o.basisPct != null ? `${o.basisPct.toFixed(2)}%` : "—"],
                ].map(([l, v]) => (
                  <div key={l} className="rounded bg-white/4 px-2 py-1">
                    <p className="text-[10px] text-muted">{l}</p>
                    <p className="font-mono">{v}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="rounded-lg border border-line p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Delivery % by session (NSE)</p>
            {view.history.length > 1 ? (
              <div className="mt-3 flex h-24 items-end gap-1">
                {view.history.map((h) => (
                  <div key={h.date} className="flex flex-1 flex-col items-center gap-1" title={`${h.date}: ${h.deliveryPct?.toFixed(1) ?? "—"}% delivered, close ${num(h.close)}`}>
                    <div className="w-full rounded-t bg-accent/60" style={{ height: `${((h.deliveryPct ?? 0) / maxDel) * 80}px` }} />
                    <span className="text-[9px] text-muted">{h.date.slice(8)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted">History builds up night by night once the database is connected.</p>
            )}
            {s && (
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                {[
                  ["Delivered", s.deliveryPct != null ? `${s.deliveryPct.toFixed(1)}%` : "—"],
                  ["Avg delivered", s.deliveryAvg != null ? `${s.deliveryAvg.toFixed(1)}%` : "—"],
                  ["Volume vs avg", s.volRatio != null ? `${s.volRatio.toFixed(1)}×` : "—"],
                  ["NSE / BSE vol", `${lakh(s.volume)} / ${s.bse ? lakh(s.bse.volume) : "—"}`],
                  ["52w high", num(s.wk52High)],
                  ["52w low", num(s.wk52Low)],
                ].map(([l, v]) => (
                  <div key={l} className="rounded bg-white/4 px-2 py-1">
                    <p className="text-[10px] text-muted">{l}</p>
                    <p className="font-mono">{v}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {view.sources.length > 0 && (
        <div className="mt-4">
          <button onClick={() => setShowSources((v) => !v)} className="flex items-center gap-1 text-xs text-muted hover:text-foreground">
            {showSources ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />} Source files ({view.sources.filter((x) => x.ok).length}/{view.sources.length} loaded)
          </button>
          {showSources && (
            <ul className="mt-2 space-y-1 text-[11px]">
              {view.sources.map((src) => (
                <li key={src.id} className="flex flex-wrap items-center gap-x-2">
                  <span className={src.ok ? "text-up" : "text-down"}>{src.ok ? "✓" : "✗"}</span>
                  <span>{src.page}</span>
                  <a href={src.url} target="_blank" rel="noreferrer" className="font-mono text-accent hover:underline">
                    {src.file}
                  </a>
                  {!src.ok && <span className="text-muted">({src.error})</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
