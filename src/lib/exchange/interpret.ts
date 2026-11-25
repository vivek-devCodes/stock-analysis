// Turns a stock's exchange data into labelled signals. Used by the agents (scoring + risk vetoes)
// and shown verbatim on the analyzer, so what you read is exactly what the agent used.
// Pure; safe on client and server; covered by src/scripts/test-exchange.ts.

import { THRESHOLDS } from "../agents/thresholds";
import type { CorporateEvents, ExchangeSignal, MarketDay, StockDay } from "./types";

const X = THRESHOLDS.exchange;
const f = (x: number, d = 2) => x.toLocaleString("en-IN", { maximumFractionDigits: d });
const pct = (x: number, d = 1) => `${x >= 0 ? "+" : ""}${x.toFixed(d)}%`;
const big = (x: number) => (Math.abs(x) >= 1e7 ? `${(x / 1e7).toFixed(2)} cr` : Math.abs(x) >= 1e5 ? `${(x / 1e5).toFixed(2)} lakh` : f(x, 0));
const daysTo = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export function interpretStock(s: StockDay | null, events: CorporateEvents | null, today: string): ExchangeSignal[] {
  const out: ExchangeSignal[] = [];
  if (s) {
    /* ---------------------------- risk: surveillance and trading restrictions ---------------------------- */
    if (s.gsm) {
      out.push({ id: "gsm", label: "Graded Surveillance (GSM)", value: s.gsm, effect: "risk", blocks: ["intraday", "swing", "long-term"], source: "seclist", detail: `NSE has placed ${s.symbol} under Graded Surveillance Measure ${s.gsm}. Trading is restricted and price discovery is unreliable — no recommendation is made.` });
    }
    if (s.series === "BE" || s.series === "BZ") {
      out.push({ id: "t2t", label: "Trade-to-trade segment", value: `Series ${s.series}`, effect: "risk", blocks: ["intraday"], source: "bhav", detail: "Every trade must be settled by delivery — intraday square-off is not allowed in this series." });
    }
    if (s.band != null && s.band <= X.tightBandPct) {
      out.push({ id: "band", label: "Tight price band", value: `${s.band}%`, effect: "risk", blocks: ["intraday"], source: "seclist", detail: `Circuit limit is ±${s.band}%. A stock this restricted can freeze at its circuit with no exit, so it is not traded intraday.` });
    } else if (s.band != null) {
      out.push({ id: "band", label: "Price band", value: `${s.band}%`, effect: "info", source: "seclist", detail: `Circuit limit ±${s.band}% for the day.` });
    } else {
      out.push({ id: "band", label: "Price band", value: "No band (F&O stock)", effect: "info", source: "seclist", detail: "F&O stocks have no fixed circuit; dynamic limits apply." });
    }
    if (s.bandHit) {
      out.push({ id: "band-hit", label: `Hit ${s.bandHit} circuit`, value: pct(s.changePct), effect: "risk", blocks: ["intraday"], source: "bhav", detail: `Closed at its ${s.bandHit} price band — one-sided order book; the next session often opens with a gap and thin liquidity.` });
    }
    if (s.fnoBan) {
      out.push({ id: "fno-ban", label: "In F&O ban period", value: "Yes", effect: "risk", source: "ban", detail: "Open interest crossed 95% of the market-wide limit: no new F&O positions; the stock is usually volatile until it exits the ban." });
    }
    if (s.annualVol != null && s.annualVol >= X.highAnnualVol) {
      out.push({ id: "vol", label: "High volatility", value: `${(s.annualVol * 100).toFixed(0)}% a year`, effect: "risk", source: "volt", detail: "NSE Clearing's annualised volatility is high; stops get hit more often — size down." });
    }

    /* --------------------------------- delivery and volume (conviction) --------------------------------- */
    if (s.deliveryPct != null) {
      const ratio = s.deliveryAvg ? s.deliveryPct / s.deliveryAvg : null;
      const high = ratio != null ? ratio >= X.deliveryHighRatio : s.deliveryPct >= X.deliveryHighAbs;
      const low = ratio != null && ratio <= X.deliveryLowRatio;
      const avgTxt = s.deliveryAvg != null ? ` vs ${s.deliveryAvg.toFixed(0)}% average (${s.historyDays} sessions)` : "";
      if (high && s.changePct > 0.3) {
        out.push({ id: "delivery", label: "Accumulation (high delivery on an up day)", value: `${s.deliveryPct.toFixed(0)}%${avgTxt}`, effect: "bullish", source: "bhav", detail: "Buyers took delivery instead of trading intraday — conviction behind the rise." });
      } else if (high && s.changePct < -0.3) {
        out.push({ id: "delivery", label: "Distribution (high delivery on a down day)", value: `${s.deliveryPct.toFixed(0)}%${avgTxt}`, effect: "bearish", source: "bhav", detail: "Sellers delivered shares — real selling, not just intraday churn." });
      } else if (low && Math.abs(s.changePct) >= 1) {
        out.push({ id: "delivery", label: "Low-delivery move", value: `${s.deliveryPct.toFixed(0)}%${avgTxt}`, effect: "risk", source: "bhav", detail: "The move was mostly intraday trading; it often fades the next session." });
      } else {
        out.push({ id: "delivery", label: "Delivery", value: `${s.deliveryPct.toFixed(0)}%${avgTxt}`, effect: "info", source: "bhav", detail: "Delivery is within its normal range." });
      }
    }
    if (s.volRatio != null && s.volRatio >= X.volumeSpike) {
      out.push({ id: "volume", label: "Volume spike", value: `${s.volRatio.toFixed(1)}× average`, effect: s.changePct > 0.3 ? "bullish" : s.changePct < -0.3 ? "bearish" : "info", source: "history", detail: `Traded ${big(s.volume)} shares vs ${s.volumeAvg ? big(s.volumeAvg) : "—"} on average, ${s.changePct >= 0 ? "up" : "down"} ${Math.abs(s.changePct).toFixed(1)}%.` });
    }

    /* ---------------------------------------- 52-week levels ---------------------------------------- */
    if (s.wk52High != null && s.close >= s.wk52High * (1 - X.near52wkPct / 100)) {
      out.push({ id: "52w", label: "At / near 52-week high", value: `${f(s.close)} vs ${f(s.wk52High)}`, effect: "bullish", source: "wk52", detail: "Stocks making new highs have no overhead supply; momentum tends to persist." });
    } else if (s.wk52Low != null && s.close <= s.wk52Low * (1 + X.near52wkPct / 100)) {
      out.push({ id: "52w", label: "At / near 52-week low", value: `${f(s.close)} vs ${f(s.wk52Low)}`, effect: "bearish", source: "wk52", detail: "Price is at its yearly low — weak relative strength." });
    }

    /* ------------------------------------------ large deals ------------------------------------------ */
    if (s.deals.length) {
      // A client that both bought and sold the same day is churning (usually an HFT/arbitrage desk).
      const sides = new Map<string, Set<string>>();
      for (const d of s.deals) sides.set(d.client, (sides.get(d.client) ?? new Set()).add(d.side));
      const real = s.deals.filter((d) => sides.get(d.client)!.size === 1);
      const net = real.reduce((a, d) => a + (d.side === "BUY" ? d.qty : -d.qty), 0);
      const names = [...new Set(real.map((d) => `${d.client} (${d.side.toLowerCase()})`))].slice(0, 3).join(", ");
      out.push({
        id: "deals",
        label: `${s.deals.some((d) => d.kind === "block") ? "Block/bulk" : "Bulk"} deals`,
        value: real.length ? `net ${net >= 0 ? "buy" : "sell"} ${big(Math.abs(net))} sh` : "two-way churn",
        effect: !real.length || net === 0 ? "info" : net > 0 ? "bullish" : "bearish",
        source: "bulk",
        detail: real.length ? `${names}${real.length > 3 ? "…" : ""}.` : "The same clients bought and sold — no directional signal.",
      });
    }

    /* ------------------------------------- derivatives (F&O) ------------------------------------- */
    const o = s.fno;
    if (o) {
      if (o.buildup) {
        const eff = o.buildup === "long build-up" || o.buildup === "short covering" ? "bullish" : "bearish";
        out.push({ id: "buildup", label: o.buildup[0].toUpperCase() + o.buildup.slice(1), value: `futures ${pct(o.futChangePct ?? 0)}, OI ${pct(o.futOiChangePct ?? 0)}`, effect: eff, source: "fo", detail: BUILDUP_TEXT[o.buildup] });
      }
      if (o.pcr != null) {
        const eff = o.pcr >= X.pcrBullish ? "bullish" : o.pcr <= X.pcrBearish ? "bearish" : "info";
        out.push({ id: "pcr", label: "Put–call ratio (OI)", value: `${o.pcr.toFixed(2)}${o.pcr >= X.pcrStretched ? " (stretched)" : ""}`, effect: eff, source: "fo", detail: eff === "bullish" ? "More puts written than calls: writers expect support below." : eff === "bearish" ? "Call writing dominates: writers expect a ceiling above." : `Balanced (expiry ${o.expiry}).` });
      }
      const spot = o.underlying ?? s.close;
      if (o.resistance != null && o.resistance >= spot && (o.resistance - spot) / spot <= X.oiLevelPct / 100) {
        out.push({ id: "oi-res", label: "At call-OI resistance", value: f(o.resistance), effect: "bearish", source: "fo", detail: "Price is just under the strike with the most call writing — upside likely capped this expiry." });
      }
      if (o.support != null && o.support <= spot && (spot - o.support) / spot <= X.oiLevelPct / 100) {
        out.push({ id: "oi-sup", label: "At put-OI support", value: f(o.support), effect: "bullish", source: "fo", detail: "Price is just above the strike with the most put writing — writers defend this level." });
      }
      out.push({ id: "oi-range", label: "Options range (OI)", value: `${o.support != null ? f(o.support) : "—"} – ${o.resistance != null ? f(o.resistance) : "—"} · max pain ${o.maxPain != null ? f(o.maxPain) : "—"}`, effect: "info", source: "fo", detail: `Expiry ${o.expiry} (${o.daysToExpiry} days). Support = highest put OI, resistance = highest call OI.` });
      if (o.atmIv != null) {
        const rich = s.annualVol != null && o.atmIv >= s.annualVol * X.ivRichRatio;
        out.push({ id: "iv", label: "ATM implied volatility", value: `${(o.atmIv * 100).toFixed(0)}%${s.annualVol != null ? ` vs ${(s.annualVol * 100).toFixed(0)}% realised` : ""}`, effect: rich ? "risk" : "info", source: "fo", detail: rich ? "Options are pricing a much bigger move than usual — an event may be due." : "Option prices are in line with recent volatility." });
      }
    }
  }

  /* ---------------------------------------- corporate events ---------------------------------------- */
  if (events?.earningsDate) {
    const d = daysTo(today, events.earningsDate);
    if (d >= 0 && d <= 1) {
      out.push({ id: "results", label: "Results due", value: events.earningsDate, effect: "risk", blocks: ["intraday"], source: "events", detail: "Quarterly results today or next session — prices can gap through any stop." });
    } else if (d > 1 && d <= X.earningsSwingDays) {
      out.push({ id: "results", label: "Results soon", value: `${events.earningsDate} (in ${d} days)`, effect: "risk", source: "events", detail: "A results announcement falls inside a swing trade's holding period." });
    } else if (d > 0) {
      out.push({ id: "results", label: "Next results", value: events.earningsDate, effect: "info", source: "events", detail: "Outside the trade window." });
    }
  }
  if (events?.exDividendDate) {
    const d = daysTo(today, events.exDividendDate);
    if (d >= 0 && d <= 3) out.push({ id: "exdiv", label: "Ex-dividend", value: events.exDividendDate, effect: "risk", source: "events", detail: "The price drops by the dividend on the ex-date — not a real move." });
  }
  return out;
}

const BUILDUP_TEXT: Record<string, string> = {
  "long build-up": "Price up with rising open interest: fresh buying positions — the strongest bullish F&O signal.",
  "short build-up": "Price down with rising open interest: fresh short positions — the strongest bearish F&O signal.",
  "short covering": "Price up while open interest falls: shorts are exiting — a rise that can fade once covering ends.",
  "long unwinding": "Price down while open interest falls: longs are exiting — weakness without fresh shorts.",
};

/** Market-wide context: breadth, FII positioning and NIFTY options. */
export function interpretMarket(m: MarketDay | null): ExchangeSignal[] {
  if (!m) return [];
  const out: ExchangeSignal[] = [];
  const b = m.breadth;
  if (b.ratio != null) {
    out.push({ id: "breadth", label: "Market breadth (A/D)", value: `${b.advances} / ${b.declines} (${b.ratio.toFixed(2)})`, effect: b.ratio >= X.breadthStrong ? "bullish" : b.ratio <= X.breadthWeak ? "bearish" : "info", source: "bhav", detail: b.ratio >= X.breadthStrong ? "Broad participation — most stocks rose." : b.ratio <= X.breadthWeak ? "Broad selling — most stocks fell." : "Mixed breadth." });
  }
  const fii = m.participants.find((p) => /fii|fpi/i.test(p.client));
  if (fii?.longPct != null) {
    out.push({ id: "fii", label: "FII index futures", value: `${(fii.longPct * 100).toFixed(0)}% long`, effect: fii.longPct >= X.fiiLongBullish ? "bullish" : fii.longPct <= X.fiiLongBearish ? "bearish" : "info", source: "participants", detail: `FII long ${fii.futIndexLong.toLocaleString("en-IN")} vs short ${fii.futIndexShort.toLocaleString("en-IN")} index-futures contracts.` });
  }
  const nifty = m.indexFno?.NIFTY;
  if (nifty?.pcr != null) {
    out.push({ id: "nifty-pcr", label: "NIFTY put–call ratio", value: nifty.pcr.toFixed(2), effect: nifty.pcr >= X.pcrBullish ? "bullish" : nifty.pcr <= X.pcrBearish ? "bearish" : "info", source: "fo", detail: `NIFTY options range ${nifty.support ?? "—"}–${nifty.resistance ?? "—"}, max pain ${nifty.maxPain ?? "—"} (expiry ${nifty.expiry}).` });
  }
  return out;
}

/** −1…+1 directional score from signals (bullish +, bearish −), weighted by id. */
export function netDirection(signals: ExchangeSignal[], ids: string[], weights: Record<string, number> = {}, mult: (s: ExchangeSignal) => number = () => 1): { score: number; used: number } {
  let sum = 0;
  let used = 0;
  for (const s of signals) {
    if (!ids.includes(s.id) || (s.effect !== "bullish" && s.effect !== "bearish")) continue;
    // `mult` is the learning loop's verdict on this signal (0 = muted as no better than chance).
    const w = (weights[s.id] ?? 1) * mult(s);
    if (w <= 0) continue;
    sum += (s.effect === "bullish" ? 1 : -1) * w;
    used += w;
  }
  return { score: used ? sum / used : 0, used };
}
