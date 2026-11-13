import { pivotLevels } from "./indicators";
import type { Candle, Indicators, Insight, NewsItem, Quote, Recommendation, Signal } from "./types";

function scoreToRec(score: number): Recommendation {
  if (score >= 18) return "BUY";
  if (score <= -18) return "SELL";
  return "HOLD";
}

export function buildInsight(
  quote: Quote,
  candles: Candle[],
  indicators: Indicators,
  news: NewsItem[],
  expectedChangePercent: number,
): Insight {
  const price = quote.price;
  const signals: Signal[] = [];
  let score = 0;

  if (indicators.sma20 && indicators.sma50) {
    if (price > indicators.sma20 && indicators.sma20 > indicators.sma50) {
      score += 14;
      signals.push({
        id: "trend",
        label: "Bullish",
        tone: "bullish",
        detail: "Price is above SMA20 and SMA20 is above SMA50.",
      });
    } else if (price < indicators.sma20 && indicators.sma20 < indicators.sma50) {
      score -= 14;
      signals.push({
        id: "trend",
        label: "Bearish",
        tone: "bearish",
        detail: "Price is below SMA20 and SMA20 is below SMA50.",
      });
    } else {
      signals.push({
        id: "trend",
        label: "Neutral",
        tone: "neutral",
        detail: "Moving averages are mixed; trend is not aligned.",
      });
    }
  }

  if (indicators.sma200) {
    if (price > indicators.sma200) {
      score += 8;
      signals.push({
        id: "regime",
        label: "Above 200DMA",
        tone: "bullish",
        detail: "Longer-term trend filter is constructive.",
      });
    } else {
      score -= 8;
      signals.push({
        id: "regime",
        label: "Below 200DMA",
        tone: "bearish",
        detail: "Price is in a longer-term downtrend regime.",
      });
    }
  }

  if (indicators.rsi != null) {
    if (indicators.rsi >= 70) {
      score -= 10;
      signals.push({
        id: "rsi",
        label: "Overbought",
        tone: "warning",
        detail: `RSI ${indicators.rsi.toFixed(1)} suggests stretched upside.`,
      });
    } else if (indicators.rsi <= 30) {
      score += 8;
      signals.push({
        id: "rsi",
        label: "Oversold",
        tone: "warning",
        detail: `RSI ${indicators.rsi.toFixed(1)} suggests stretched downside.`,
      });
    } else if (indicators.rsi >= 55) {
      score += 6;
      signals.push({
        id: "rsi",
        label: "RSI constructive",
        tone: "bullish",
        detail: `RSI ${indicators.rsi.toFixed(1)} is in a bullish mid-range.`,
      });
    } else if (indicators.rsi <= 45) {
      score -= 6;
      signals.push({
        id: "rsi",
        label: "RSI weak",
        tone: "bearish",
        detail: `RSI ${indicators.rsi.toFixed(1)} is in a bearish mid-range.`,
      });
    }
  }

  if (indicators.macdHistogram != null) {
    if (indicators.macdHistogram > 0) {
      score += 8;
      signals.push({
        id: "macd",
        label: "MACD positive",
        tone: "bullish",
        detail: "MACD histogram is above zero, supporting momentum.",
      });
    } else {
      score -= 8;
      signals.push({
        id: "macd",
        label: "MACD negative",
        tone: "bearish",
        detail: "MACD histogram is below zero, momentum is fading.",
      });
    }
  }

  if (indicators.volumeRatio != null && indicators.volumeRatio > 1.6) {
    signals.push({
      id: "volume",
      label: "Volume spike",
      tone: "warning",
      detail: `Volume is ${indicators.volumeRatio.toFixed(1)}x the 20-period average.`,
    });
    score += quote.changePercent >= 0 ? 4 : -4;
  }

  if (indicators.realizedVol != null && indicators.realizedVol > 45) {
    score -= 4;
    signals.push({
      id: "vol",
      label: "High volatility",
      tone: "warning",
      detail: `Realized volatility is ${indicators.realizedVol.toFixed(1)}% annualized.`,
    });
  }

  const newsScore = news.reduce((sum, item) => sum + item.score, 0);
  if (newsScore > 1) {
    score += 6;
    signals.push({
      id: "news",
      label: "Positive news",
      tone: "bullish",
      detail: "Recent headlines lean constructive.",
    });
  } else if (newsScore < -1) {
    score -= 6;
    signals.push({
      id: "news",
      label: "Negative news",
      tone: "bearish",
      detail: "Recent headlines lean cautious.",
    });
  }

  if (expectedChangePercent > 1.5) score += 8;
  else if (expectedChangePercent < -1.5) score -= 8;

  const { support, resistance } = pivotLevels(candles);
  const recommendation = scoreToRec(score);
  const confidence = Math.max(0.32, Math.min(0.86, 0.42 + Math.abs(score) / 90));

  const working: string[] = [];
  const notWorking: string[] = [];
  const risks: string[] = [];

  signals
    .filter((s) => s.tone === "bullish")
    .forEach((s) => working.push(s.detail));
  signals
    .filter((s) => s.tone === "bearish")
    .forEach((s) => notWorking.push(s.detail));
  signals
    .filter((s) => s.tone === "warning")
    .forEach((s) => risks.push(s.detail));

  if (quote.pe && quote.pe > 45) {
    risks.push(`Valuation is elevated with a trailing P/E of ${quote.pe.toFixed(1)}.`);
  }
  if (support.length === 0) {
    risks.push("Nearby support is sparse, so a breakdown could extend.");
  }
  if (resistance[0] && (resistance[0] - price) / price < 0.02) {
    risks.push("Price is close to resistance; a rejection is possible.");
  }
  if (!working.length) working.push("No strong bullish alignment across the primary trend filters.");
  if (!notWorking.length) {
    notWorking.push("No dominant bearish breakdown in the current indicator set.");
  }

  const headline =
    recommendation === "BUY"
      ? "Setup favors accumulation, with trend and momentum aligned."
      : recommendation === "SELL"
        ? "Setup favors caution or reduction; downside pressure is in control."
        : "Setup is mixed. Wait for confirmation rather than forcing a directional bet.";

  return {
    recommendation,
    score,
    confidence,
    headline,
    summary: `${quote.symbol} is ${quote.changePercent >= 0 ? "up" : "down"} ${Math.abs(quote.changePercent).toFixed(2)}% with ${indicators.realizedVol?.toFixed(1) ?? "n/a"}% realized volatility. The ensemble model sees a ${expectedChangePercent >= 0 ? "modest upside" : "modest downside"} of ${expectedChangePercent.toFixed(2)}% over the next forecast window, with a ${recommendation} bias at ${(confidence * 100).toFixed(0)}% confidence.`,
    working,
    notWorking,
    risks,
    support,
    resistance,
    reasoning: [
      `Technical score is ${score > 0 ? "+" : ""}${score} from trend, RSI, MACD, volume, news, and forecast drift.`,
      indicators.rsi != null
        ? `RSI at ${indicators.rsi.toFixed(1)} ${indicators.rsi > 70 ? "is overbought" : indicators.rsi < 30 ? "is oversold" : "is mid-range"}.`
        : "RSI is unavailable on this range.",
      support[0]
        ? `Closest support sits near ${support[0].toFixed(2)}; closest resistance near ${resistance[0]?.toFixed(2) ?? "n/a"}.`
        : "Pivot clustering did not produce a clean nearby support.",
      "This is a data-driven snapshot, not a personalised recommendation.",
    ],
    signals,
  };
}

export function newsSentiment(news: NewsItem[]) {
  if (!news.length) return { label: "neutral" as const, score: 0 };
  const score = news.reduce((sum, item) => sum + item.score, 0) / news.length;
  const label = score > 0.15 ? "positive" : score < -0.15 ? "negative" : "neutral";
  return { label, score };
}
