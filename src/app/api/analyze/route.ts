import { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { buildInsight, newsSentiment } from "@/lib/analysis";
import { buildForecast } from "@/lib/forecast";
import { computeIndicators } from "@/lib/indicators";
import { engineSignals } from "@/lib/engine-signals";
import { enrichQuote, fetchChart, fetchNews, RANGE_INTERVAL } from "@/lib/yahoo";

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
    // Swing-engine markers only make sense on daily candles; replay with 2 years of warm-up history.
    const engine =
      interval === "1d" && candles.length
        ? await fetchChart(symbol, "2y", "1d").then(({ candles: d }) => engineSignals(quote.symbol, d, candles[0].time)).catch(() => [])
        : [];

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
      engineSignals: engine,
      provider: "Yahoo Finance (NSE/BSE via .NS/.BO suffixes; global equities and indices)",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to analyze symbol";
    return Response.json({ error: message }, { status: 502 });
  }
}
