import calibration from "./calibration.json";
import { pivotLevels } from "./indicators";
import type { Candle, Indicators, Insight, NewsItem, Quote, Recommendation, Signal, TrackRecord } from "./types";

/**
 * Swing-trading decision engine (1–2 week horizon).
 *
 * Backtesting the previous score showed short-term returns in large-cap NSE stocks MEAN-REVERT:
 * "momentum" BUYs and "oversold" SELLs were wrong more often than right. So the rule is the
 * classic trend-filter + pullback entry:
 *   BUY   = long-term uptrend   AND short-term pullback      (buy weakness in a healthy trend)
 *   SELL  = long-term downtrend AND short-term bounce        (sell strength in a weak trend)
 *   HOLD  = everything else (mixed trend, chasing an extended move, shorting a washout)
 * Confidence is the measured out-of-sample hit rate of that call (src/lib/calibration.json),
 * not a made-up number.
 */

type Regime = "up" | "down" | "mixed";

type CalStat = { n: number; hitRate: number; expectancy: number; profitFactor: number; edge: number; proven: boolean } | null;
const CAL = calibration as unknown as {
  horizonDays: number;
  period: string | null;
  buy: CalStat;
  sell: CalStat;
};

function trackFor(rec: Recommendation): TrackRecord {
  const c = rec === "BUY" ? CAL.buy : rec === "SELL" ? CAL.sell : null;
  if (!c) {
    return { status: "untested", hitRate: null, expectancy: null, profitFactor: null, edge: null, samples: 0, horizonDays: CAL.horizonDays, period: CAL.period };
  }
  return {
    status: c.proven ? "proven" : "unproven",
    hitRate: c.hitRate,
    expectancy: c.expectancy,
    profitFactor: c.profitFactor,
    edge: c.edge,
    samples: c.n,
    horizonDays: CAL.horizonDays,
    period: CAL.period,
  };
}

function regimeOf(price: number, ind: Indicators): Regime {
  const { sma50, sma200 } = ind;
  if (sma50 == null || sma200 == null) return "mixed";
  if (price > sma200 && sma50 > sma200) return "up";
  if (price < sma200 && sma50 < sma200) return "down";
  return "mixed";
}

export function buildInsight(
  quote: Quote,
  candles: Candle[],
  indicators: Indicators,
  news: NewsItem[],
): Insight {
  const price = quote.price;
  const ind = indicators;
  const signals: Signal[] = [];
  const risks: string[] = [];
  const rsi = ind.rsi;
  const regime = regimeOf(price, ind);

  // Short-term position relative to the 20-day mean and the Bollinger bands.
  const pullback = (rsi != null && rsi <= 45) || (ind.sma20 != null && price < ind.sma20);
  const deepPullback = (rsi != null && rsi <= 35) || (ind.bbLower != null && price <= ind.bbLower);
  const bounce = (rsi != null && rsi >= 55) || (ind.sma20 != null && price > ind.sma20);
  const extended = (rsi != null && rsi >= 70) || (ind.bbUpper != null && price >= ind.bbUpper);
  const washout = (rsi != null && rsi <= 25) || (ind.bbLower != null && price < ind.bbLower);

  let score = 0;

  // 1. Long-term regime (the trend filter).
  if (regime === "up") {
    score += 30;
    signals.push({ id: "regime", label: "Uptrend", tone: "bullish", detail: "Price is above the 200-day average and the 50-day is above the 200-day (long-term uptrend)." });
  } else if (regime === "down") {
    score -= 30;
    signals.push({ id: "regime", label: "Downtrend", tone: "bearish", detail: "Price is below the 200-day average and the 50-day is below the 200-day (long-term downtrend)." });
  } else {
    signals.push({ id: "regime", label: "Mixed trend", tone: "neutral", detail: "50/200-day averages disagree with price — no clear long-term trend." });
  }

  // 2. Short-term setup, judged relative to the regime.
  if (regime === "up") {
    if (deepPullback) {
      score += 30;
      signals.push({ id: "setup", label: "Deep pullback", tone: "bullish", detail: `Sharp dip inside an uptrend (RSI ${rsi?.toFixed(0) ?? "—"}) — historically the better entry.` });
    } else if (pullback) {
      score += 20;
      signals.push({ id: "setup", label: "Pullback", tone: "bullish", detail: `Pulled back below its 20-day average / RSI ${rsi?.toFixed(0) ?? "—"} while the long-term trend is up.` });
    } else if (extended) {
      score -= 15;
      signals.push({ id: "setup", label: "Extended", tone: "warning", detail: `Stretched above its range (RSI ${rsi?.toFixed(0) ?? "—"}) — wait for a pullback rather than chasing.` });
    }
  } else if (regime === "down") {
    if (washout) {
      score += 15;
      signals.push({ id: "setup", label: "Washed out", tone: "warning", detail: `Deeply oversold (RSI ${rsi?.toFixed(0) ?? "—"}) — shorting here risks a sharp relief bounce.` });
    } else if (extended) {
      score -= 30;
      signals.push({ id: "setup", label: "Rally into resistance", tone: "bearish", detail: `Bounced hard (RSI ${rsi?.toFixed(0) ?? "—"}) inside a downtrend — a typical sell-the-rally zone.` });
    } else if (bounce) {
      score -= 20;
      signals.push({ id: "setup", label: "Relief bounce", tone: "bearish", detail: "Trading above its 20-day average while the long-term trend is down." });
    }
  } else if (rsi != null && (rsi >= 70 || rsi <= 30)) {
    signals.push({ id: "setup", label: rsi >= 70 ? "Overbought" : "Oversold", tone: "warning", detail: `RSI ${rsi.toFixed(0)} with no clear trend — likely to revert, but no trend to trade with.` });
  }

  // 3. Trend strength (ADX/DMI) — confirms, never overrides.
  if (ind.adx != null) {
    const diUp = (ind.plusDI ?? 0) > (ind.minusDI ?? 0);
    if (ind.adx >= 25 && regime !== "mixed" && diUp === (regime === "up")) {
      score += regime === "up" ? 5 : -5;
      signals.push({ id: "adx", label: `ADX ${ind.adx.toFixed(0)} trending`, tone: regime === "up" ? "bullish" : "bearish", detail: `ADX ${ind.adx.toFixed(0)} with ${diUp ? "+DI" : "−DI"} leading: the trend has strength.` });
    } else if (ind.adx < 20) {
      signals.push({ id: "adx", label: `ADX ${ind.adx.toFixed(0)} weak`, tone: "neutral", detail: `ADX ${ind.adx.toFixed(0)}: little trend strength, so ranges and false breakouts are more likely.` });
    }
  }

  // 4. MACD — shown for context; it lags, so it is not part of the decision.
  if (ind.macdHistogram != null) {
    signals.push({
      id: "macd",
      label: ind.macdHistogram > 0 ? "MACD rising" : "MACD falling",
      tone: "neutral",
      detail: `MACD histogram ${ind.macdHistogram > 0 ? "above" : "below"} zero (short-term momentum ${ind.macdHistogram > 0 ? "improving" : "fading"}).`,
    });
  }

  // 5. Headlines nudge only (keyword sentiment is a weak signal).
  const newsScore = news.reduce((sum, item) => sum + item.score, 0);
  if (newsScore > 1) {
    score += 4;
    signals.push({ id: "news", label: "Positive news", tone: "bullish", detail: "Recent headlines lean constructive." });
  } else if (newsScore < -1) {
    score -= 4;
    signals.push({ id: "news", label: "Negative news", tone: "bearish", detail: "Recent headlines lean cautious — check for event risk." });
  }

  // Risk notes (never change the call, but always shown).
  if (ind.volumeRatio != null && ind.volumeRatio >= 2) risks.push(`Volume is ${ind.volumeRatio.toFixed(1)}× its 20-day average — a news or event-driven move.`);
  if (ind.realizedVol != null && ind.realizedVol > 45) risks.push(`High volatility (${ind.realizedVol.toFixed(0)}% annualised) — size positions smaller.`);
  if (quote.pe && quote.pe > 60) risks.push(`Rich valuation: trailing P/E ${quote.pe.toFixed(1)}.`);

  const { support, resistance } = pivotLevels(candles);
  if (!support.length) risks.push("No nearby support level, so a breakdown could extend.");
  if (resistance[0] && (resistance[0] - price) / price < 0.02) risks.push("Price is within 2% of resistance; a rejection is possible.");

  // The call requires BOTH the trend filter and the setup (confluence), not just a high score.
  let recommendation: Recommendation = "HOLD";
  if (regime === "up" && pullback && !extended) recommendation = "BUY";
  else if (regime === "down" && bounce && !washout) recommendation = "SELL";

  score = Math.max(-100, Math.min(100, score));
  const track = trackFor(recommendation);
  // Confidence = measured out-of-sample hit rate of this call; 0.5 (a coin flip) when untested.
  const confidence = track.hitRate ?? 0.5;

  const working = signals.filter((s) => s.tone === "bullish").map((s) => s.detail);
  const notWorking = signals.filter((s) => s.tone === "bearish").map((s) => s.detail);
  risks.unshift(...signals.filter((s) => s.tone === "warning").map((s) => s.detail));
  if (!working.length) working.push("No bullish trend-plus-pullback alignment right now.");
  if (!notWorking.length) notWorking.push("No bearish trend-plus-bounce alignment right now.");

  const headline =
    recommendation === "BUY"
      ? "Buy-the-dip setup: long-term uptrend with a short-term pullback."
      : recommendation === "SELL"
        ? "Sell-the-rally setup: long-term downtrend with a short-term bounce."
        : regime === "up" && extended
          ? "Uptrend, but extended — wait for a pullback instead of chasing."
          : regime === "down" && washout
            ? "Downtrend, but washed out — avoid fresh shorts here."
            : "No high-probability setup. Wait for trend and timing to line up.";

  const trackText =
    recommendation === "HOLD"
      ? "HOLD means no setup — not a prediction that the price will stay flat."
      : track.status === "untested"
        ? "This call type has no backtest record yet."
        : `Track record: right ${((track.hitRate ?? 0) * 100).toFixed(0)}% of the time over ${track.horizonDays} trading days, ${((track.expectancy ?? 0) * 100).toFixed(2)}% per trade after costs, ${track.samples} out-of-sample signals${track.period ? ` (${track.period})` : ""}. ${
            track.status === "proven" ? "Proven: it beat the average stock after costs." : "Unproven: it did NOT beat the average stock after costs — treat it as a setup, not a prediction."
          }`;

  return {
    recommendation,
    track,
    score,
    confidence,
    headline,
    summary: `${quote.symbol} is ${quote.changePercent >= 0 ? "up" : "down"} ${Math.abs(quote.changePercent).toFixed(2)}% today. Long-term trend: ${regime}. ${headline} ${trackText}`,
    working,
    notWorking,
    risks,
    support,
    resistance,
    reasoning: [
      `Trend filter: ${regime === "up" ? "uptrend" : regime === "down" ? "downtrend" : "mixed"} (price ${ind.sma200 ? (price > ind.sma200 ? "above" : "below") : "vs"} 200-DMA${ind.sma200 ? ` ${ind.sma200.toFixed(2)}` : ""}).`,
      rsi != null ? `RSI(14) ${rsi.toFixed(1)}${ind.adx != null ? `, ADX ${ind.adx.toFixed(0)} (${ind.adx >= 25 ? "trending" : ind.adx < 20 ? "weak trend" : "moderate"})` : ""}.` : "RSI unavailable on this range.",
      support[0] ? `Nearest support ${support[0].toFixed(2)}; nearest resistance ${resistance[0]?.toFixed(2) ?? "n/a"}.` : "No clean nearby support.",
      trackText,
      "Rule-based research, not personalised investment advice.",
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
