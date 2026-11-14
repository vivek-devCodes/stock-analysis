import { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { buildInsight, newsSentiment } from "@/lib/analysis";
import { buildForecast } from "@/lib/forecast";
import { computeIndicators } from "@/lib/indicators";
import { engineSignals } from "@/lib/engine-signals";
import { crossSignals, type ChartSignal } from "@/lib/chart-studies";
import { enrichQuote, fetchChart, fetchNews, RANGE_INTERVAL, WARMUP_RANGE } from "@/lib/yahoo";
import type { Candle } from "@/lib/types";

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
  const symbol = request.nextUrl.searchParams.get("symbol")?.trim();
  const range = request.nextUrl.searchParams.get("range") ?? "1y";
  if (!symbol) {
    return Response.json({ error: "symbol is required" }, { status: 400 });
  }
  if (!RANGE_INTERVAL[range]) {
    return Response.json({ error: "unsupported range" }, { status: 400 });
  }

  try {
    const { quote: rawQuote, candles, interval } = await fetchChart(symbol, range);
    if (candles.length < 15) {
      return Response.json({ error: "Not enough market history for this symbol." }, { status: 422 });
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
      provider: "Yahoo Finance (NSE/BSE via .NS/.BO suffixes; global equities and indices)",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to analyze symbol";
    return Response.json({ error: message }, { status: 502 });
  }
}
