"use client";

import Link from "next/link";
import { AlertTriangle, Briefcase, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { PortfolioView } from "@/lib/portfolio/engine";
import { clsx } from "@/lib/format";
import { Card, PageHeader } from "../shell/PageHeader";

const inr = (x: number | null | undefined) => (x == null ? "—" : `₹${Math.round(x).toLocaleString("en-IN")}`);
const signed = (x: number | null | undefined, d = 2) => (x == null ? "—" : `${x >= 0 ? "+" : ""}${x.toFixed(d)}%`);
const tone = (x: number | null | undefined) => (x == null ? "" : x > 0 ? "text-up" : x < 0 ? "text-down" : "");
const sym = (s: string) => s.replace(/\.(NS|BO)$/, "");

/** Portfolio and NIFTY, both rebased to 100 on the first day. */
function Growth({ history }: { history: PortfolioView["history"] }) {
  const pts = useMemo(() => {
    const first = history[0];
    const n0 = history.find((h) => h.nifty != null)?.nifty ?? null;
    return history.map((h) => ({ day: h.day, p: (h.nav / first.nav) * 100, n: n0 && h.nifty ? (h.nifty / n0) * 100 : null }));
  }, [history]);
  if (pts.length < 2) return <p className="text-xs text-muted">The growth chart appears after the second recorded day.</p>;
  const W = 640;
  const H = 180;
  const vals = pts.flatMap((x) => [x.p, x.n ?? x.p]);
  const lo = Math.min(...vals) - 0.5;
  const hi = Math.max(...vals) + 0.5;
  const x = (i: number) => (i / (pts.length - 1)) * W;
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const line = (get: (p: (typeof pts)[number]) => number | null) =>
    pts
      .map((p, i) => [i, get(p)] as const)
      .filter(([, v]) => v != null)
      .map(([i, v], k) => `${k ? "L" : "M"}${x(i).toFixed(1)},${y(v!).toFixed(1)}`)
      .join(" ");
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-44 w-full" preserveAspectRatio="none" role="img" aria-label="Portfolio vs NIFTY 50, rebased to 100">
        <line x1={0} x2={W} y1={y(100)} y2={y(100)} stroke="currentColor" className="text-line" strokeDasharray="4 4" />
        <path d={line((p) => p.n)} fill="none" stroke="#94a3b8" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        <path d={line((p) => p.p)} fill="none" stroke="#22c55e" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-muted">
        <span>{pts[0].day}</span>
        <span className="flex gap-3">
          <span className="text-up">● Portfolio</span>
          <span>● NIFTY 50</span>
        </span>
        <span>{pts.at(-1)!.day}</span>
      </div>
    </div>
  );
}

export function Portfolio() {
  const [data, setData] = useState<PortfolioView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/portfolio", { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Could not load the portfolio");
      setData(j as PortfolioView);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(id);
  }, [load]);

  async function rebalanceNow() {
    if (data?.started && !window.confirm("Rebalance now at the latest prices? The monthly schedule continues afterwards.")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/portfolio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "rebalance" }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Rebalance failed");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const d = data;
  const rules = d?.rules;
  return (
    <div className="space-y-5">
      <PageHeader
        icon={Briefcase}
        tone="text-[#34d399]"
        title="Momentum + Quality Portfolio"
        subtitle="A paper basket of strong, profitable, low-debt stocks in an uptrend — equal-weighted, rebalanced on the first session of every month, and measured against NIFTY 50."
        actions={
          <button type="button" onClick={() => void rebalanceNow()} disabled={busy} className="inline-flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm text-muted hover:bg-white/5 disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} {d?.started ? "Rebalance now" : "Start the portfolio"}
          </button>
        }
      />
      {error && (
        <p className="flex items-center gap-2 text-sm text-down">
          <AlertTriangle className="h-4 w-4" /> {error}
        </p>
      )}
      {!d && !error && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      )}
      {busy && <p className="text-xs text-muted">Screening ~120 stocks for momentum and quality (about a minute)…</p>}

      {d && !d.started && (
        <Card title="Not started yet">
          <p className="text-sm">The portfolio starts automatically after the close on the first trading day of next month, or now with “Start the portfolio”.</p>
        </Card>
      )}

      {d?.started && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Portfolio value", inr(d.nav), `from ${inr(d.capital)} on ${d.since}`],
              ["Portfolio return", signed(d.returnPct), "after costs"],
              ["NIFTY 50 over the same period", signed(d.niftyReturnPct), "benchmark"],
              ["Ahead of NIFTY by", d.niftyReturnPct != null ? signed(d.returnPct - d.niftyReturnPct) : "—", `next rebalance: ${d.nextRebalance}`],
            ].map(([l, v, s], i) => (
              <div key={l} className="rounded-xl border border-line bg-card p-3">
                <p className="text-[11px] text-muted">{l}</p>
                <p className={clsx("mt-1 font-mono text-lg", i === 1 ? tone(d.returnPct) : i === 2 ? tone(d.niftyReturnPct) : i === 3 && d.niftyReturnPct != null ? tone(d.returnPct - d.niftyReturnPct) : "")}>{v}</p>
                <p className="text-[10px] text-muted">{s}</p>
              </div>
            ))}
          </div>

          <Card title="Growth vs NIFTY 50 (rebased to 100)">
            <Growth history={d.history} />
          </Card>

          <Card title={`Holdings (${d.holdings.length})`}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-xs">
                <thead className="text-left text-muted">
                  <tr>
                    <th className="pb-1 font-normal">Stock</th>
                    <th className="pb-1 font-normal">Sector</th>
                    <th className="pb-1 text-right font-normal">Qty</th>
                    <th className="pb-1 text-right font-normal">Bought</th>
                    <th className="pb-1 text-right font-normal">Now</th>
                    <th className="pb-1 text-right font-normal">P&amp;L</th>
                    <th className="pb-1 text-right font-normal">Weight</th>
                    <th className="pb-1 font-normal pl-3">Why it is held</th>
                  </tr>
                </thead>
                <tbody>
                  {d.holdings.map((h) => (
                    <tr key={h.symbol} className="border-t border-line/40 align-top">
                      <td className="py-1.5">
                        <Link href={`/analyze?symbol=${encodeURIComponent(h.symbol)}`} className="font-medium hover:text-accent hover:underline">
                          {sym(h.symbol)}
                        </Link>
                        <p className="text-[10px] text-muted">since {h.entryDay}</p>
                      </td>
                      <td className="py-1.5">{h.sector}</td>
                      <td className="py-1.5 text-right font-mono">{h.qty}</td>
                      <td className="py-1.5 text-right font-mono">{h.entryPrice.toFixed(2)}</td>
                      <td className="py-1.5 text-right font-mono">{h.price?.toFixed(2) ?? "—"}</td>
                      <td className={clsx("py-1.5 text-right font-mono", tone(h.pnlPct))}>{signed(h.pnlPct, 1)}</td>
                      <td className="py-1.5 text-right font-mono">{h.weightPct != null ? `${h.weightPct.toFixed(1)}%` : "—"}</td>
                      <td className="py-1.5 pl-3 text-[11px] text-muted">{h.reasons.join(" · ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[10px] text-muted">Cash {inr(d.cash)}. Prices are live/last close; Yahoo NSE quotes can lag 15 minutes.</p>
          </Card>

          <Card title="Rebalance history">
            <ul className="space-y-2 text-xs">
              {d.rebalances.map((r) => (
                <li key={r.day} className="border-t border-line/40 pt-2 first:border-0 first:pt-0">
                  <p>
                    <b>{r.day}</b> — value {inr(r.navBefore)} → {inr(r.navAfter)} · costs {inr(r.costs)} · {r.eligible} of {r.screened} stocks qualified
                  </p>
                  <p className="text-muted">
                    In: {r.entered.map(sym).join(", ") || "—"} · Out: {r.exited.map(sym).join(", ") || "—"} · Kept: {r.kept.map(sym).join(", ") || "—"}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}

      {rules && (
        <Card title="Rules">
          <ul className="space-y-1 text-xs">
            <li>· Universe: the app&apos;s fundamentals universe (NIFTY 50 and sector leaders). Paper capital {inr(rules.capital)}.</li>
            <li>· Eligible: above its 200-day average, positive 6- and 12-month momentum (excluding the last month), fundamentals quality ≥ {rules.minQuality}, ROE ≥ {rules.minRoe}%, debt/equity ≤ {rules.maxDebtToEquity} (banks and finance exempt).</li>
            <li>· Ranked 50/50 on momentum and quality; the top {rules.size} are held equally, at most {rules.maxPerSector} per sector.</li>
            <li>· Rebalanced after the close on the first trading session of each month; {rules.costPct}% round-trip costs charged on every change.</li>
            <li>· Momentum and quality are among the best-documented long-run equity factors, but they have long losing stretches too. Simulated only — not investment advice.</li>
          </ul>
        </Card>
      )}
    </div>
  );
}
