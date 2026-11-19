import { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { buildInsight, newsSentiment } from "@/lib/analysis";
import { buildForecast } from "@/lib/forecast";
import { computeIndicators } from "@/lib/indicators";
import { engineSignals } from "@/lib/engine-signals";
import { crossSignals, type ChartSignal } from "@/lib/chart-studies";
import { enrichQuote, fetchChart, fetchNews, RANGE_INTERVAL, WARMUP_RANGE } from "@/lib/yahoo";
import type { Candle } from "@/lib/types";

const MIN_CANDLES = 15;

/** The same company's ticker on the other Indian exchange (.NS <-> .BO), or null for other symbols. */
function otherListing(symbol: string): string | null {
  const m = /^(.+)\.(NS|BO)$/i.exec(symbol);
  if (!m) return null;
  return `${m[1]}.${m[2].toUpperCase() === "NS" ? "BO" : "NS"}`;
}

const istDay = (t: number) => Math.floor((t + 19800) / 86400);

/** Swing-engine and golden/death-cross signals from daily candles, from the start of the visible range. */
function dailyRules(symbol: string, daily: Candle[], visibleFrom: number): ChartSignal[] {
  if (daily.length < 220) return [];
  const from = (istDay(visibleFrom) * 86400) - 19800 - 7 * 86400; // a week of slack for weekly charts
  return [...engineSignals(symbol, daily, from), ...crossSignals(daily).filter((s) => s.time >= from)];
}

/**
 * Put each daily signal on a candle that exists in this chart: the same day on daily charts, the first
 * candle of that IST day on intraday charts, and the week containing it on weekly charts.
 */
function snapToChart(signals: ChartSignal[], candles: Candle[], interval: string): ChartSignal[] {
  const out: ChartSignal[] = [];
  for (const s of signals) {
    let target: Candle | undefined;
    if (interval === "1d") target = candles.find((c) => istDay(c.time) === istDay(s.time));
    else if (interval === "1wk") target = [...candles].reverse().find((c) => c.time <= s.time);
    else target = candles.find((c) => istDay(c.time) === istDay(s.time));
    if (target) out.push({ ...s, time: target.time, detail: interval === "1d" ? s.detail : `${s.detail} (daily signal for ${new Date(s.time * 1000).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })})` });
  }
  return out;
}

export async function GET(request: NextRequest) {
  const auth = await requireRole(request);
  if (auth instanceof Response) return auth;
  let symbol = request.nextUrl.searchParams.get("symbol")?.trim();
  const range = request.nextUrl.searchParams.get("range") ?? "1y";
  if (!symbol) {
    return Response.json({ error: "symbol is required" }, { status: 400 });
  }
  if (!RANGE_INTERVAL[range]) {
    return Response.json({ error: "unsupported range" }, { status: 400 });
  }

  try {
    let notice: string | undefined;
    // A stock that just moved exchange (e.g. BSE SME -> NSE main board) has only a few sessions under
    // its new ticker. Its history lives under the other Indian listing, so use that one instead.
    const alt = otherListing(symbol);
    let chart = await fetchChart(symbol, range).catch((e) => {
      if (!alt) throw e;
      return null;
    });
    const have = chart?.candles.length ?? 0;
    if (alt && have < MIN_CANDLES) {
      const other = await fetchChart(alt, range).catch(() => null);
      if (other && other.candles.length > have) {
        notice = `${symbol} has only ${have} session${have === 1 ? "" : "s"} of history on Yahoo (likely a recent listing or exchange move), so this shows the ${alt.endsWith(".BO") ? "BSE" : "NSE"} listing ${alt} instead.`;
        chart = other;
        symbol = alt;
      }
    }
    if (!chart) throw new Error(`No market data for ${symbol}`);
    const { quote: rawQuote, candles, interval } = chart;
    if (candles.length < MIN_CANDLES) {
      return Response.json(
        { error: `Not enough market history for ${symbol}: Yahoo has ${candles.length} session${candles.length === 1 ? "" : "s"}, and the analyzer needs at least ${MIN_CANDLES}` },
        { status: 422 },
      );
    }
    const [quote, news] = await Promise.all([enrichQuote(rawQuote), fetchNews(symbol, rawQuote.name)]);
    const indicators = computeIndicators(candles);
    const horizon = range === "1d" || range === "5d" ? 12 : 10;
    const forecast = buildForecast(candles, indicators, horizon);
    const insight = buildInsight(quote, candles, indicators, news);
    // Extra earlier candles at the same interval, so every indicator has warm-up on every range.
    const w = WARMUP_RANGE[range];
    const warm: Candle[] = w ? await fetchChart(symbol, w.range, w.interval).then((r) => r.candles).catch(() => []) : [];
    const byTime = new Map<number, Candle>();
    for (const c of warm) byTime.set(c.time, c);
    for (const c of candles) byTime.set(c.time, c); // the chart's own candles win (freshest)
    const studyCandles = [...byTime.values()].sort((a, b) => a.time - b.time);
    // Swing-engine and golden/death-cross markers are DAILY rules. Compute them on daily history
    // (~210 bars of warm-up) for every range, then place each one on the chart's own candles.
    const dailyHistory =
      interval === "1d" && studyCandles.length >= 260
        ? studyCandles
        : await fetchChart(symbol, range === "5y" ? "5y" : "2y", "1d").then((r) => r.candles).catch(() => [] as Candle[]);
    const dailySignals = candles.length ? snapToChart(dailyRules(quote.symbol, dailyHistory, candles[0].time), candles, interval) : [];

    return Response.json({
      quote,
      candles,
      range,
      interval,
      indicators,
      insight,
      forecast,
      news,
      newsSentiment: newsSentiment(news),
      dailySignals,
      studyCandles,
      notice,
      provider: "Yahoo Finance (NSE/BSE via .NS/.BO suffixes; global equities and indices)",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to analyze symbol";
    return Response.json({ error: message }, { status: 502 });
  }
}
