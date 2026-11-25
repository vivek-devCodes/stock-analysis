"use client";

import Link from "next/link";
import { ExternalLink, Loader2, RefreshCw, UserCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { VERDICT_TEXT, type InsiderStock } from "@/lib/insider/core";
import type { InsiderPick, InsiderScreen, InsiderTrack } from "@/lib/insider/run";
import { clsx } from "@/lib/format";
import { Card, PageHeader } from "../shell/PageHeader";

type Payload = { screen: InsiderScreen | null; track: InsiderTrack; history: Array<{ day: string; ready: string[] }> };

const lakh = (v: number) => (Math.abs(v) >= 1e7 ? `₹${(v / 1e7).toFixed(2)} cr` : `₹${(v / 1e5).toFixed(1)} L`);
const pct = (x: number | null, d = 1) => (x == null ? "—" : `${x >= 0 ? "+" : ""}${x.toFixed(d)}%`);
const VERDICT_CLS = { ready: "bg-up/15 text-up", wait: "bg-warn/15 text-warn", avoid: "bg-down/15 text-down", "no-data": "bg-white/8 text-muted" } as const;

export function InsiderBuying() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/insider", { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Could not load");
      setData(j as Payload);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    const id = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(id);
  }, [load]);

  async function refresh() {
    setBusy(true);
    try {
      const res = await fetch("/api/insider", { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Refresh failed");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const s = data?.screen;
  const t = data?.track;
  return (
    <div className="space-y-4 p-4">
      <PageHeader
        icon={UserCheck}
        tone="text-[#facc15]"
        title="Insider Buying"
        subtitle="Promoters, directors and key managers buying their own company's shares in the open market (NSE insider-trading disclosures, last 7 days) — then checked on the daily chart before it counts."
        actions={
          <button onClick={() => void refresh()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs hover:bg-white/5 disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Fetch latest from NSE
          </button>
        }
      />
      {error && <div className="panel border-down/40 p-3 text-sm text-down">{error}</div>}
      {!data && !error && (
        <div className="panel flex h-40 items-center justify-center gap-2 text-muted">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading…
        </div>
      )}
      {data && !s && (
        <Card title="No screen yet">
          <p className="text-sm text-muted">The screen is built every night after the close. Click &quot;Fetch latest from NSE&quot; to build it now (about a minute).</p>
        </Card>
      )}

      {s && (
        <>
          <div className="grid gap-3 md:grid-cols-4">
            {[
              ["Disclosures read", String(s.filings), `screen of ${s.day}`],
              ["Stocks with insider buying", String(s.buying.length), "promoter / director / KMP market purchases"],
              ["Setup ready on the chart", String(s.buying.filter((p) => p.chart.verdict === "ready").length), "bullish structure or support, room to resistance"],
              ["Track record (5 sessions)", t && t.picks ? `${pct(t.after5Avg)} avg` : "building", t && t.picks ? `${t.picks} picks · ${t.after5Hit != null ? `${Math.round(t.after5Hit * 100)}% up` : "—"} · next day ${pct(t.nextAvg, 2)}` : "measured on every 'ready' pick"],
            ].map(([k, v, sub]) => (
              <div key={k} className="panel p-3">
                <p className="text-[11px] uppercase tracking-wider text-muted">{k}</p>
                <p className="mt-1 text-xl font-semibold">{v}</p>
                <p className="text-[11px] text-muted">{sub}</p>
              </div>
            ))}
          </div>

          <Card title="Insiders buying — ranked by insider strength and chart">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-muted">
                  <tr>
                    <th className="pb-2 font-normal">#</th>
                    <th className="pb-2 font-normal">Stock</th>
                    <th className="pb-2 text-right font-normal">Net bought</th>
                    <th className="pb-2 text-right font-normal">Insiders</th>
                    <th className="pb-2 font-normal">Who</th>
                    <th className="pb-2 text-right font-normal">Insider</th>
                    <th className="pb-2 pl-3 font-normal">Daily chart</th>
                    <th className="pb-2 text-right font-normal">Support / Resist.</th>
                    <th className="pb-2 text-right font-normal">Rank</th>
                  </tr>
                </thead>
                <tbody>
                  {s.buying.map((p, i) => (
                    <PickRow key={p.symbol} p={p} i={i} open={open === p.symbol} onToggle={() => setOpen(open === p.symbol ? null : p.symbol)} />
                  ))}
                  {!s.buying.length && (
                    <tr>
                      <td colSpan={9} className="py-3 text-muted">
                        No promoter / director market purchases in the last 7 days.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[10px] text-muted">
              Counts only open-market purchases and sales by promoters, promoter group, directors and key managerial personnel — ESOP trusts, gifts, allotments, pledges and inter-se transfers are ignored. Disclosures can arrive up to two trading days after the trade. Click a row for the individual trades.
            </p>
          </Card>

          {s.selling.length > 0 && (
            <Card title="Insiders selling (a warning, not a short signal)">
              <div className="flex flex-wrap gap-2 text-xs">
                {s.selling.map((x: InsiderStock) => (
                  <Link key={x.symbol} href={`/analyze?symbol=${x.symbol}.NS`} className="rounded-md border border-down/30 bg-down/10 px-2 py-1 text-down hover:bg-down/20">
                    {x.symbol} · {lakh(-x.netValue)} sold
                  </Link>
                ))}
              </div>
            </Card>
          )}

          {s.errors.length > 0 && <p className="text-[11px] text-warn">Data notes: {s.errors.join(" | ")}</p>}
          <p className="text-[11px] text-muted">
            Source: NSE corporate filings — insider trading (SEBI PIT Regulation 7(2)), fetched nightly; each disclosure&apos;s XBRL file from NSE&apos;s archive. Research, not advice: insider buying is evidence, not a guarantee. The strategy&apos;s own track record above shows whether it is working.
          </p>
        </>
      )}
    </div>
  );
}

function PickRow({ p, i, open, onToggle }: { p: InsiderPick; i: number; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="cursor-pointer border-t border-line hover:bg-white/5" onClick={onToggle}>
        <td className="py-2 text-muted">{i + 1}</td>
        <td className="py-2">
          <Link href={`/analyze?symbol=${p.symbol}.NS`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 font-semibold hover:text-accent">
            {p.symbol} <ExternalLink className="h-3 w-3 opacity-50" />
          </Link>
          <div className="text-[10px] text-muted">{p.company}</div>
        </td>
        <td className="py-2 text-right font-semibold text-up">{lakh(p.netValue)}</td>
        <td className="py-2 text-right">
          {p.buyers}
          {p.sellers ? <span className="text-down"> / {p.sellers} sold</span> : null}
        </td>
        <td className="py-2">
          {p.promoterBuy && (
            <span className="mr-1 inline-flex items-center gap-0.5 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
              <UserCheck className="h-3 w-3" /> Promoter
            </span>
          )}
          <span className="text-muted">{p.categories.filter((c) => !/promoter/i.test(c)).join(", ")}</span>
        </td>
        <td className="py-2 text-right">{p.insiderScore}</td>
        <td className="py-2 pl-3">
          <span className={clsx("rounded px-1.5 py-0.5 text-[10px] font-semibold", VERDICT_CLS[p.chart.verdict])}>{VERDICT_TEXT[p.chart.verdict]}</span>
          {p.chart.structure && <span className="ml-1 text-[10px] text-muted">{p.chart.structure}</span>}
        </td>
        <td className="py-2 text-right text-muted">
          {p.chart.support?.toFixed(1) ?? "—"} / {p.chart.resistance?.toFixed(1) ?? "—"}
        </td>
        <td className="py-2 text-right font-semibold">{p.rank}</td>
      </tr>
      {open && (
        <tr className="bg-white/[0.02]">
          <td />
          <td colSpan={8} className="pb-3 pt-1">
            <ul className="space-y-0.5">
              {p.people.map((x, k) => (
                <li key={k}>
                  <span className={x.type === "Buy" ? "text-up" : "text-down"}>{x.type === "Buy" ? "Bought" : "Sold"}</span> {lakh(x.value)} — {x.person} <span className="text-muted">({x.category}{x.date ? `, ${x.date}` : ""})</span>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-muted">Chart: {p.chart.reasons.join(" · ")}</p>
          </td>
        </tr>
      )}
    </>
  );
}
