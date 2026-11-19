"use client";

import Link from "next/link";
import { AlertTriangle, Building2, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { SHORT_PAGE } from "@/lib/exchange/catalog";
import type { LiveMovers } from "@/lib/exchange/live";
import type { ExchangeSignal, FnoSummary, ListRow, MarketDay } from "@/lib/exchange/types";
import { clsx } from "@/lib/format";
import { Card, PageHeader } from "../shell/PageHeader";

type Payload = { market: MarketDay | null; signals: ExchangeSignal[]; live: LiveMovers | null };

const num = (x: number | null | undefined, d = 2) => (x == null || !Number.isFinite(x) ? "—" : x.toLocaleString("en-IN", { maximumFractionDigits: d }));
const pct = (x: number | null | undefined, d = 2) => (x == null || !Number.isFinite(x) ? "—" : `${x > 0 ? "+" : ""}${x.toFixed(d)}%`);
const tone = (x: number) => (x > 0 ? "text-up" : x < 0 ? "text-down" : "text-muted");
const EFFECT: Record<string, string> = { bullish: "border-up/30 text-up", bearish: "border-down/30 text-down", risk: "border-warn/30 text-warn", info: "border-line text-foreground" };

function StockLink({ symbol }: { symbol: string }) {
  return (
    <Link href={`/analyze?symbol=${encodeURIComponent(`${symbol}.NS`)}`} className="font-medium hover:text-accent hover:underline">
      {symbol}
    </Link>
  );
}

function ListCard({ title, rows, value, source }: { title: string; rows: ListRow[]; value: (r: ListRow) => string; source: string }) {
  return (
    <Card title={title}>
      <p className="-mt-1 mb-2 text-[10px] text-muted">{source}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-muted">None.</p>
      ) : (
        <table className="w-full text-xs">
          <tbody>
            {rows.slice(0, 12).map((r) => (
              <tr key={r.symbol + (r.note ?? "")} className="border-t border-line/40">
                <td className="py-1">
                  <StockLink symbol={r.symbol} />
                </td>
                <td className="py-1 text-right font-mono">{num(r.close)}</td>
                <td className={clsx("py-1 text-right font-mono", tone(r.changePct))}>{pct(r.changePct)}</td>
                <td className="py-1 text-right font-mono text-muted" title={r.note}>
                  {value(r)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function IndexOptions({ name, f }: { name: string; f: FnoSummary }) {
  return (
    <div className="rounded-lg bg-white/3 p-3">
      <p className="text-sm font-semibold">{name}</p>
      <p className="text-[10px] text-muted">
        expiry {f.expiry} ({f.daysToExpiry}d) · spot {num(f.underlying)}
      </p>
      <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
        {[
          ["PCR", f.pcr?.toFixed(2) ?? "—"],
          ["Max pain", num(f.maxPain, 0)],
          ["ATM IV", f.atmIv != null ? `${(f.atmIv * 100).toFixed(1)}%` : "—"],
          ["Support (put OI)", num(f.support, 0)],
          ["Resistance (call OI)", num(f.resistance, 0)],
          ["Futures", f.buildup ?? "—"],
        ].map(([l, v]) => (
          <div key={l}>
            <p className="text-[10px] text-muted">{l}</p>
            <p className="font-mono">{v}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MarketData() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/exchange/market", { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Could not load exchange data");
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
      const res = await fetch("/api/exchange/market", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "refresh" }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Refresh failed");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const m = data?.market;
  return (
    <div className="space-y-5">
      <PageHeader
        icon={Building2}
        tone="text-[#60a5fa]"
        title="NSE Market Data"
        subtitle={m ? `Official NSE / BSE end-of-day files for the ${m.tradeDate} session — the same data the AI agents and the next-session plan use.` : "Official NSE / BSE end-of-day files — the same data the AI agents use."}
        actions={
          <button type="button" onClick={() => void refresh()} disabled={busy} className="inline-flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm text-muted hover:bg-white/5 disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Check for new files
          </button>
        }
      />
      {error && (
        <p className="flex items-center gap-2 text-sm text-down">
          <AlertTriangle className="h-4 w-4" /> {error}
        </p>
      )}
      {!data && !error && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading NSE files (the first load of a new day downloads them, ~10–30 s)…
        </p>
      )}

      {m && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {data!.signals.map((s) => (
              <div key={s.id} className={clsx("rounded-xl border bg-card p-3", EFFECT[s.effect])}>
                <p className="text-[11px] text-muted">{s.label}</p>
                <p className="mt-1 font-mono text-lg">{s.value}</p>
                <p className="mt-1 text-[11px] text-muted">{s.detail}</p>
                <p className="mt-1 text-[10px] text-muted">{SHORT_PAGE[s.source]}</p>
              </div>
            ))}
            <div className="rounded-xl border border-line bg-card p-3">
              <p className="text-[11px] text-muted">Coverage</p>
              <p className="mt-1 font-mono text-lg">{m.counts.equities.toLocaleString("en-IN")}</p>
              <p className="mt-1 text-[11px] text-muted">
                NSE securities · {m.counts.fnoUnderlyings} F&amp;O stocks · {m.counts.bse.toLocaleString("en-IN")} BSE securities
              </p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Index options (option chain, end of day)">
              <div className="grid gap-3 sm:grid-cols-2">
                {Object.entries(m.indexFno).map(([k, f]) => (
                  <IndexOptions key={k} name={k} f={f} />
                ))}
              </div>
            </Card>
            <Card title="Participant-wise open interest (index futures)">
              <table className="w-full text-xs">
                <thead className="text-left text-muted">
                  <tr>
                    <th className="pb-1 font-normal">Participant</th>
                    <th className="pb-1 text-right font-normal">Long</th>
                    <th className="pb-1 text-right font-normal">Short</th>
                    <th className="pb-1 text-right font-normal">Long %</th>
                  </tr>
                </thead>
                <tbody>
                  {m.participants.map((p) => (
                    <tr key={p.client} className="border-t border-line/40">
                      <td className="py-1 font-medium">{p.client}</td>
                      <td className="py-1 text-right font-mono">{p.futIndexLong.toLocaleString("en-IN")}</td>
                      <td className="py-1 text-right font-mono">{p.futIndexShort.toLocaleString("en-IN")}</td>
                      <td className={clsx("py-1 text-right font-mono", p.longPct != null && p.longPct >= 0.6 ? "text-up" : p.longPct != null && p.longPct <= 0.3 ? "text-down" : "")}>{p.longPct != null ? `${(p.longPct * 100).toFixed(0)}%` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[10px] text-muted">{SHORT_PAGE.participants}. FII = foreign institutions, DII = domestic institutions, Pro = brokers&apos; own trading.</p>
            </Card>
          </div>

          {data!.live && (data!.live.gainers.length > 0 || data!.live.losers.length > 0) && (
            <div className="grid gap-4 lg:grid-cols-2">
              <ListCard title="Live gainers" rows={data!.live.gainers} value={(r) => `₹${r.value.toFixed(1)} cr`} source={`${data!.live.source}${data!.live.updatedAt ? ` · ${new Date(data!.live.updatedAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" })} IST` : ""}`} />
              <ListCard title="Live losers" rows={data!.live.losers} value={(r) => `₹${r.value.toFixed(1)} cr`} source={data!.live.source} />
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <ListCard title="Top gainers" rows={m.gainers} value={() => ""} source={`${SHORT_PAGE.bhav} · ≥ ₹1 cr traded`} />
            <ListCard title="Top losers" rows={m.losers} value={() => ""} source={`${SHORT_PAGE.bhav} · ≥ ₹1 cr traded`} />
            <ListCard title="Most active (value)" rows={m.mostActive} value={(r) => `₹${num(r.value, 0)} cr`} source={SHORT_PAGE.bhav} />
            <ListCard title="Volume gainers" rows={m.volumeGainers} value={(r) => `${r.value.toFixed(1)}×`} source={`${SHORT_PAGE.bhav} vs stored average`} />
            <ListCard title="High delivery" rows={m.highDelivery} value={(r) => `${r.value.toFixed(0)}%`} source={`${SHORT_PAGE.bhav} · ≥ ₹10 cr traded`} />
            <ListCard title="Most active underlyings (F&O)" rows={m.mostActiveUnderlying} value={(r) => `${(r.value / 1e3).toFixed(0)}k`} source={`${SHORT_PAGE.fo} · contracts`} />
            <ListCard title="OI spurts (futures)" rows={m.oiSpurts} value={(r) => `${pct(r.value, 1)} ${r.note ?? ""}`} source={`${SHORT_PAGE.fo} · open-interest change`} />
            <ListCard title="52-week highs" rows={m.wk52Highs} value={(r) => num(r.value)} source={SHORT_PAGE.wk52} />
            <ListCard title="52-week lows" rows={m.wk52Lows} value={(r) => num(r.value)} source={SHORT_PAGE.wk52} />
            <ListCard title="Price band hitters (circuits)" rows={m.bandHitters} value={(r) => r.note ?? ""} source={SHORT_PAGE.seclist} />
          </div>

          <Card title={`Large deals — bulk & block (${m.deals.length})`}>
            {m.deals.length === 0 ? (
              <p className="text-xs text-muted">No large deals reported.</p>
            ) : (
              <div className="max-h-96 overflow-auto">
                <table className="w-full min-w-[640px] text-xs">
                  <thead className="sticky top-0 bg-card text-left text-muted">
                    <tr>
                      {["Stock", "Client", "Side", "Quantity", "Price", "Type"].map((h) => (
                        <th key={h} className="pb-1 font-normal">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {m.deals.map((d, i) => (
                      <tr key={i} className="border-t border-line/40">
                        <td className="py-1">
                          <StockLink symbol={d.symbol} />
                        </td>
                        <td className="py-1">{d.client}</td>
                        <td className={clsx("py-1 font-semibold", d.side === "BUY" ? "text-up" : "text-down")}>{d.side}</td>
                        <td className="py-1 font-mono">{d.qty.toLocaleString("en-IN")}</td>
                        <td className="py-1 font-mono">{num(d.price)}</td>
                        <td className="py-1 text-muted">{d.kind}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-2 text-[10px] text-muted">{SHORT_PAGE.bulk}. A client that both bought and sold the same day is churning (often HFT), and the agent ignores it.</p>
          </Card>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card title={`F&O ban (${m.fnoBan.length})`}>
              <p className="text-xs">{m.fnoBan.length ? m.fnoBan.map((s) => <StockLink key={s} symbol={s} />).reduce((a, b) => <>{a}, {b}</>) : "No stocks in the ban period."}</p>
              <p className="mt-2 text-[10px] text-muted">{SHORT_PAGE.ban}. No new F&amp;O positions; usually volatile.</p>
            </Card>
            <Card title={`Graded Surveillance — GSM (${m.gsm.length})`}>
              <div className="max-h-48 overflow-auto text-xs">
                {m.gsm.map((g) => (
                  <p key={g.symbol}>
                    <StockLink symbol={g.symbol} /> <span className="text-muted">{g.stage}</span>
                  </p>
                ))}
              </div>
              <p className="mt-2 text-[10px] text-muted">{SHORT_PAGE.seclist}. The agent never recommends these.</p>
            </Card>
            <Card title="Indices (close, P/E, P/B)">
              <div className="max-h-48 overflow-auto">
                <table className="w-full text-xs">
                  <tbody>
                    {m.indices.slice(0, 60).map((x) => (
                      <tr key={x.name} className="border-t border-line/40">
                        <td className="py-1">{x.name}</td>
                        <td className="py-1 text-right font-mono">{num(x.close)}</td>
                        <td className={clsx("py-1 text-right font-mono", tone(x.changePct))}>{pct(x.changePct)}</td>
                        <td className="py-1 text-right font-mono text-muted">{x.pe != null ? `P/E ${x.pe}` : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          <Card title="Source files">
            <ul className="space-y-1 text-[11px]">
              {m.sources.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-x-2">
                  <span className={s.ok ? "text-up" : "text-down"}>{s.ok ? "✓" : "✗"}</span>
                  <span>{s.page}</span>
                  <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-mono text-accent hover:underline">
                    {s.file} <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                  {s.ok ? <span className="text-muted">{s.rows.toLocaleString("en-IN")} rows</span> : <span className="text-muted">({s.error})</span>}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[10px] text-muted">
              Built {new Date(m.builtAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST. NSE&apos;s live option chain, pre-open screen, holiday list and corporate-action pages are only served through its cookie-protected
              website API, so they are not used: option analytics come from the official F&amp;O bhavcopy, the opening gap is measured at 09:15 from the live feed, holidays are detected from the bhavcopy, and results dates
              come from Yahoo Finance.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
