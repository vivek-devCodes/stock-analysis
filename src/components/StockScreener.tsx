"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BadgeIndianRupee,
  ExternalLink,
  Filter,
  Flame,
  Gem,
  Inbox,
  Layers,
  Loader2,
  Rocket,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { clsx } from "@/lib/format";
import { PageHeader } from "./shell/PageHeader";

type F = {
  symbol: string;
  name: string;
  sector: string;
  price: number | null;
  marketCapCr: number | null;
  pe: number | null;
  pb: number | null;
  roe: number | null;
  debtToEquity: number | null;
  revenueGrowth: number | null;
  earningsGrowth: number | null;
  netMargin: number | null;
  dividendYield: number | null;
  insiderHolding: number | null;
  fromHigh52: number | null;
  scores: { quality: number; growth: number; value: number; overall: number };
  flags: string[];
};

type Preset = { id: string; label: string; hint: string; icon: LucideIcon; test: (f: F) => boolean };
const ge = (v: number | null, n: number) => v != null && v >= n;
const le = (v: number | null, n: number) => v != null && v <= n;

const PRESETS: Preset[] = [
  { id: "all", icon: Layers, label: "All stocks", hint: "Ranked by overall score", test: () => true },
  { id: "quality", icon: Gem, label: "Quality compounders", hint: "ROE ≥ 15%, debt/equity ≤ 0.5, revenue growth ≥ 10%", test: (f) => ge(f.roe, 15) && (f.debtToEquity == null || le(f.debtToEquity, 0.5)) && ge(f.revenueGrowth, 10) },
  { id: "value", icon: BadgeIndianRupee, label: "Value picks", hint: "P/E ≤ 20, P/B ≤ 3, ROE ≥ 12%", test: (f) => ge(f.pe, 0.01) && le(f.pe, 20) && le(f.pb, 3) && ge(f.roe, 12) },
  { id: "growth", icon: Rocket, label: "High growth", hint: "Revenue and earnings growth ≥ 15%", test: (f) => ge(f.revenueGrowth, 15) && ge(f.earningsGrowth, 15) },
  { id: "dividend", icon: Wallet, label: "Dividend payers", hint: "Dividend yield ≥ 2%", test: (f) => ge(f.dividendYield, 2) },
  { id: "debtfree", icon: ShieldCheck, label: "Debt-free", hint: "Debt/equity ≤ 0.1", test: (f) => le(f.debtToEquity, 0.1) },
  { id: "momentum", icon: Flame, label: "Near 52-week high", hint: "Within 5% of the 52-week high", test: (f) => ge(f.fromHigh52, -5) },
];

type Col = { key: string; label: string; get: (f: F) => number | null; fmt?: (v: number) => string; good?: (v: number) => boolean | null };
const p1 = (v: number) => `${v.toFixed(1)}%`;
const COLS: Col[] = [
  { key: "overall", label: "Score", get: (f) => f.scores.overall },
  { key: "price", label: "Price", get: (f) => f.price, fmt: (v) => v.toLocaleString("en-IN", { maximumFractionDigits: 2 }) },
  { key: "mcap", label: "M.Cap ₹Cr", get: (f) => f.marketCapCr, fmt: (v) => v.toLocaleString("en-IN") },
  { key: "pe", label: "P/E", get: (f) => f.pe, fmt: (v) => v.toFixed(1), good: (v) => (v <= 0 ? false : v <= 20 ? true : v > 50 ? false : null) },
  { key: "pb", label: "P/B", get: (f) => f.pb, fmt: (v) => v.toFixed(2) },
  { key: "roe", label: "ROE", get: (f) => f.roe, fmt: p1, good: (v) => (v >= 15 ? true : v < 8 ? false : null) },
  { key: "de", label: "Debt/Eq", get: (f) => f.debtToEquity, fmt: (v) => v.toFixed(2), good: (v) => (v <= 0.5 ? true : v > 1 ? false : null) },
  { key: "rg", label: "Rev gr.", get: (f) => f.revenueGrowth, fmt: p1, good: (v) => (v >= 10 ? true : v < 0 ? false : null) },
  { key: "eg", label: "EPS gr.", get: (f) => f.earningsGrowth, fmt: p1, good: (v) => (v >= 10 ? true : v < 0 ? false : null) },
  { key: "nm", label: "Net margin", get: (f) => f.netMargin, fmt: p1 },
  { key: "dy", label: "Div yield", get: (f) => f.dividendYield, fmt: (v) => `${v.toFixed(2)}%` },
  { key: "ins", label: "Promoter*", get: (f) => f.insiderHolding, fmt: p1 },
  { key: "hi", label: "From 52W hi", get: (f) => f.fromHigh52, fmt: p1 },
];

const short = (s: string) => s.replace(/\.NS$/, "");

export function StockScreener() {
  const [stocks, setStocks] = useState<F[] | null>(null);
  const [meta, setMeta] = useState<{ fetchedAt: string; failed: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preset, setPreset] = useState("all");
  const [sector, setSector] = useState("All");
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "overall", dir: -1 });
  const [custom, setCustom] = useState({ minRoe: "", maxPe: "", maxDe: "", minGrowth: "", minYield: "" });

  useEffect(() => {
    fetch("/api/fundamentals")
      .then(async (res) => {
        if (res.status === 401) return window.location.replace("/login");
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Could not load fundamentals");
        setStocks(json.stocks);
        setMeta({ fetchedAt: json.fetchedAt, failed: json.failed });
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load fundamentals"));
  }, []);

  const sectors = useMemo(() => ["All", ...new Set((stocks ?? []).map((s) => s.sector))], [stocks]);
  const activePreset = PRESETS.find((p) => p.id === preset) ?? PRESETS[0];

  const rows = useMemo(() => {
    const n = (v: string) => (v.trim() === "" ? null : Number(v));
    const c = { minRoe: n(custom.minRoe), maxPe: n(custom.maxPe), maxDe: n(custom.maxDe), minGrowth: n(custom.minGrowth), minYield: n(custom.minYield) };
    const col = COLS.find((x) => x.key === sort.key) ?? COLS[0];
    return (stocks ?? [])
      .filter((f) => activePreset.test(f))
      .filter((f) => sector === "All" || f.sector === sector)
      .filter((f) => c.minRoe == null || ge(f.roe, c.minRoe))
      .filter((f) => c.maxPe == null || (ge(f.pe, 0.01) && le(f.pe, c.maxPe)))
      .filter((f) => c.maxDe == null || le(f.debtToEquity, c.maxDe))
      .filter((f) => c.minGrowth == null || ge(f.revenueGrowth, c.minGrowth))
      .filter((f) => c.minYield == null || ge(f.dividendYield, c.minYield))
      .sort((a, b) => {
        const av = col.get(a);
        const bv = col.get(b);
        if (av == null) return 1;
        if (bv == null) return -1;
        return (av - bv) * sort.dir;
      });
  }, [stocks, activePreset, sector, custom, sort]);

  const toggleSort = (key: string) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: -1 }));

  return (
    <div>
      <main className="space-y-4 p-4 sm:p-6">
        <PageHeader
          icon={Filter}
          tone="text-[#4fd1c5]"
          title="Stock Screener"
          subtitle="Rank NSE stocks on fundamentals — quality, growth and value — like Screener.in, from raw data"
        />
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPreset(p.id)}
              title={p.hint}
              className={clsx(
                "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs",
                p.id === preset ? "border-accent bg-accent/15 text-accent" : "border-line text-muted hover:text-foreground",
              )}
            >
              <p.icon className="h-3.5 w-3.5" />
              {p.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted">{activePreset.hint}</p>

        <div className="panel flex flex-wrap items-end gap-3 p-3 text-xs">
          <SlidersHorizontal className="mb-2 h-4 w-4 text-muted" />
          <label className="space-y-1">
            <span className="block text-muted">Sector</span>
            <select value={sector} onChange={(e) => setSector(e.target.value)} className="rounded-lg border border-line bg-card px-2 py-1.5 text-sm">
              {sectors.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          {(
            [
              ["minRoe", "Min ROE %"],
              ["maxPe", "Max P/E"],
              ["maxDe", "Max debt/eq"],
              ["minGrowth", "Min revenue growth %"],
              ["minYield", "Min dividend %"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="space-y-1">
              <span className="block text-muted">{label}</span>
              <input
                inputMode="decimal"
                value={custom[key]}
                onChange={(e) => setCustom((c) => ({ ...c, [key]: e.target.value.replace(/[^0-9.\-]/g, "") }))}
                className="w-24 rounded-lg border border-line bg-card px-2 py-1.5 text-sm"
              />
            </label>
          ))}
          <button onClick={() => setCustom({ minRoe: "", maxPe: "", maxDe: "", minGrowth: "", minYield: "" })} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-muted hover:text-foreground">
            <RotateCcw className="h-3.5 w-3.5" />
            Clear
          </button>
        </div>

        {error && (
          <p className="panel flex items-center gap-2 border-down/40 p-3 text-sm text-down">
            <AlertTriangle className="h-4 w-4" /> {error}
          </p>
        )}
        {stocks && rows.length === 0 && (
          <p className="panel flex items-center gap-2 p-6 text-sm text-muted">
            <Inbox className="h-5 w-5" /> No stocks match this screen. Try loosening the filters.
          </p>
        )}
        {!stocks && !error && (
          <div className="panel flex items-center gap-3 p-6 text-sm text-muted">
            <Loader2 className="h-5 w-5 animate-spin" /> Pulling fundamentals for the NSE universe… the first load takes about 20 seconds.
          </div>
        )}

        {stocks && (
          <>
            <p className="text-xs text-muted">
              {rows.length} of {stocks.length} stocks · data from Yahoo Finance, refreshed every 6 h
              {meta?.failed.length ? ` · unavailable: ${meta.failed.map(short).join(", ")}` : ""}
            </p>
            <div className="panel overflow-x-auto">
              <table className="w-full min-w-[1100px] text-xs">
                <thead>
                  <tr className="border-b border-line text-left text-muted">
                    <th className="px-3 py-2 font-medium">Stock</th>
                    {COLS.map((c) => (
                      <th key={c.key} className="px-2 py-2 text-right font-medium">
                        <button onClick={() => toggleSort(c.key)} className="inline-flex items-center gap-0.5 hover:text-foreground">
                          {c.label}
                          {sort.key === c.key && (sort.dir === -1 ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
                        </button>
                      </th>
                    ))}
                    <th className="px-3 py-2 font-medium">Links</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((f) => (
                    <tr key={f.symbol} className="border-b border-line/60 hover:bg-white/[0.03]">
                      <td className="px-3 py-2">
                        <Link href={`/analyze?symbol=${encodeURIComponent(f.symbol)}`} className="font-semibold hover:text-accent">
                          {short(f.symbol)}
                        </Link>
                        <p className="max-w-[200px] truncate text-[11px] text-muted">{f.name} · {f.sector}</p>
                        {f.flags.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {f.flags.map((fl) => (
                              <span key={fl} className={clsx("rounded px-1.5 text-[10px]", fl === "Near 52W high" ? "bg-up/15 text-up" : "bg-warn/15 text-warn")}>
                                {fl}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      {COLS.map((c) => {
                        const v = c.get(f);
                        if (c.key === "overall") {
                          return (
                            <td key={c.key} className="px-2 py-2 text-right" title={`Quality ${f.scores.quality} · Growth ${f.scores.growth} · Value ${f.scores.value}`}>
                              <span className={clsx("rounded-md px-2 py-0.5 font-mono font-semibold", v! >= 65 ? "bg-up/15 text-up" : v! >= 45 ? "bg-warn/15 text-warn" : "bg-down/15 text-down")}>
                                {v}
                              </span>
                              <p className="mt-0.5 text-[10px] text-muted">
                                Q{f.scores.quality} G{f.scores.growth} V{f.scores.value}
                              </p>
                            </td>
                          );
                        }
                        const good = v != null && c.good ? c.good(v) : null;
                        return (
                          <td key={c.key} className={clsx("px-2 py-2 text-right font-mono", good === true && "text-up", good === false && "text-down")}>
                            {v == null ? <span className="text-muted">—</span> : c.fmt ? c.fmt(v) : v}
                          </td>
                        );
                      })}
                      <td className="whitespace-nowrap px-3 py-2">
                        <a href={`https://www.screener.in/company/${encodeURIComponent(short(f.symbol))}/`} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                          Screener <ExternalLink className="inline h-3 w-3" />
                        </a>
                        {" · "}
                        <a href={`https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(short(f.symbol))}`} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                          NSE <ExternalLink className="inline h-3 w-3" />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-muted">
              Score = 45% quality (ROE, debt, margins) + 30% growth (revenue, earnings) + 25% value (P/E, P/B, dividend). Debt/equity is
              ignored for banks and NBFCs. *Promoter = insider holding as reported by Yahoo. Missing data is not penalised. Not investment advice.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
