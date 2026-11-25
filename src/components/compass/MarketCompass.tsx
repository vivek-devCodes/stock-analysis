"use client";

import { Compass as CompassIcon, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Compass, CompassOutcome } from "@/lib/compass/core";
import type { MarketTile } from "@/lib/compass/fetch";
import { clsx } from "@/lib/format";
import { Card } from "../shell/PageHeader";

type Payload = { compass: Compass; tiles: MarketTile[]; history: { outcomes: CompassOutcome[]; accuracy: { days: number; calls: number; gapHit: number | null; dayHit: number | null } } | null };

const pct = (x: number | null, d = 2) => (x == null ? "—" : `${x >= 0 ? "+" : ""}${x.toFixed(d)}%`);
const TONE = { bullish: "text-up", bearish: "text-down", neutral: "text-muted", missing: "text-muted" } as const;
const TONE_TEXT = { bullish: "Positive", bearish: "Negative", neutral: "Neutral", missing: "No data" } as const;
const BIAS_CLS: Record<Compass["bias"], string> = {
  "gap-up": "border-up/50 bg-up/15 text-up",
  positive: "border-up/30 bg-up/10 text-up",
  flat: "border-line bg-white/5 text-foreground",
  negative: "border-down/30 bg-down/10 text-down",
  "gap-down": "border-down/50 bg-down/15 text-down",
  unknown: "border-line bg-white/5 text-muted",
};

/** The 9 AM pre-market checklist as one card, plus every market on one screen. */
export function MarketCompassCard() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (refresh = false) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/compass${refresh ? "?refresh=1" : ""}`, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Could not load the compass");
      setData(j as Payload);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    const id = window.setInterval(() => void load(), 120_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [load]);

  const c = data?.compass;
  const acc = data?.history?.accuracy;
  return (
    <Card icon={CompassIcon} tone="text-[#22d3ee]" title="Market Compass — pre-market checklist">
      {error && <p className="text-sm text-down">{error}</p>}
      {!data && !error && (
        <div className="flex items-center gap-2 py-6 text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Reading global cues…
        </div>
      )}
      {c && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className={clsx("rounded-xl border px-3 py-2 text-base font-semibold", BIAS_CLS[c.bias])}>
              {c.biasText}
              {c.score != null && <span className="ml-2 text-xs opacity-80">score {c.score > 0 ? "+" : ""}{c.score}</span>}
            </span>
            {c.expectedGapPct != null && <span className="text-sm">GIFT Nifty implies <b className={c.expectedGapPct >= 0 ? "text-up" : "text-down"}>{pct(c.expectedGapPct)}</b> at the open</span>}
            <span className={clsx("rounded-md px-2 py-1 text-xs font-semibold", c.volatility === "volatile" ? "bg-warn/15 text-warn" : c.volatility === "calm" ? "bg-accent/15 text-accent" : "bg-white/5 text-muted")}>{c.volatility === "volatile" ? "Volatile (VIX ≥ 15)" : c.volatility === "calm" ? "Calm (VIX < 15)" : "VIX n/a"}</span>
            <button onClick={() => void load(true)} disabled={busy} className="ml-auto inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-muted hover:text-foreground disabled:opacity-50">
              <RefreshCw className={clsx("h-3.5 w-3.5", busy && "animate-spin")} /> Refresh
            </button>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <div>
              <table className="w-full text-xs">
                <tbody>
                  {c.checks.map((k) => (
                    <tr key={k.id} className="border-t border-line">
                      <td className="py-1.5 pr-2 font-medium">{k.label}</td>
                      <td className="py-1.5 pr-2 text-muted">{k.reading}</td>
                      <td className={clsx("py-1.5 text-right font-semibold", TONE[k.tone])}>{k.id === "vix" ? "" : TONE_TEXT[k.tone]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ul className="mt-2 space-y-1 text-sm">
                <li className="text-muted">· {c.volatilityText}</li>
                {c.playbook.map((p) => (
                  <li key={p}>· {p}</li>
                ))}
              </ul>
              <p className="mt-2 text-[10px] text-muted">
                {acc && acc.calls ? `Track record: right about the open ${acc.gapHit != null ? Math.round(acc.gapHit * 100) : "—"}% and the day ${acc.dayHit != null ? Math.round(acc.dayHit * 100) : "—"}% of ${acc.calls} directional calls. ` : "Track record builds from tomorrow: each morning's reading is graded against NIFTY's actual open. "}
                Data coverage {Math.round(c.coverage * 100)}% · updated {new Date(c.asOf).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" })} IST
              </p>
            </div>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {data.tiles.map((t) => (
                <div key={t.symbol} className="rounded-lg border border-line bg-card px-2 py-1.5">
                  <p className="truncate text-[10px] uppercase tracking-wider text-muted">{t.label}</p>
                  <p className="text-sm font-semibold">{t.price != null ? t.price.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—"}</p>
                  <p className={clsx("text-[11px] font-semibold", (t.changePct ?? 0) >= 0 ? (t.symbol === "^INDIAVIX" ? "text-down" : "text-up") : t.symbol === "^INDIAVIX" ? "text-up" : "text-down")}>{pct(t.changePct)}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
