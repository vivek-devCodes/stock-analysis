import { GoogleGenAI, Type } from "@google/genai";
import type { Candle, Indicators, Quote, NewsItem } from "./types";
import type { DailyReport, StockPick, SectorAnalysis } from "./email-template";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? "" });

const MODEL = "gemini-2.5-flash";

/* ------------------------------------------------------------------ */
/*  Schema for structured LLM output                                  */
/* ------------------------------------------------------------------ */

const stockPickSchema = {
  type: Type.OBJECT,
  properties: {
    symbol: { type: Type.STRING, description: "Stock ticker e.g. RELIANCE.NS" },
    name: { type: Type.STRING, description: "Company name" },
    sector: { type: Type.STRING, description: "Sector name" },
    currentPrice: { type: Type.NUMBER, description: "Current/last traded price" },
    targetPrice: { type: Type.NUMBER, description: "Expected target price" },
    stopLoss: { type: Type.NUMBER, description: "Recommended stop-loss level" },
    recommendation: { type: Type.STRING, description: "BUY, SELL, or HOLD" },
    confidence: { type: Type.NUMBER, description: "Confidence 0-100" },
    reasoning: { type: Type.STRING, description: "2-3 sentence explanation" },
    technicalSignals: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Key technical signals e.g. RSI oversold, MACD bullish crossover",
    },
    riskLevel: { type: Type.STRING, description: "LOW, MEDIUM, or HIGH" },
  },
  propertyOrdering: [
    "symbol",
    "name",
    "sector",
    "currentPrice",
    "targetPrice",
    "stopLoss",
    "recommendation",
    "confidence",
    "reasoning",
    "technicalSignals",
    "riskLevel",
  ],
};

const analysisResponseSchema = {
  type: Type.OBJECT,
  properties: {
    marketSentiment: { type: Type.STRING, description: "BULLISH, BEARISH, or NEUTRAL" },
    sentimentReason: {
      type: Type.STRING,
      description: "1-2 sentence explanation of overall market sentiment",
    },
    intradayPicks: {
      type: Type.ARRAY,
      items: stockPickSchema,
      description: "Top 3-5 stocks for intraday trading today",
    },
    shortTermPicks: {
      type: Type.ARRAY,
      items: stockPickSchema,
      description: "Top 3-5 stocks for short-term (1-2 weeks) swing trades",
    },
    longTermPicks: {
      type: Type.ARRAY,
      items: stockPickSchema,
      description: "Top 3-5 fundamentally strong stocks for 3-6 months",
    },
    stocksToAvoid: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          symbol: { type: Type.STRING },
          name: { type: Type.STRING },
          reason: { type: Type.STRING },
        },
        propertyOrdering: ["symbol", "name", "reason"],
      },
      description: "Stocks to avoid with reasons",
    },
    sectorAnalysis: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          sector: { type: Type.STRING },
          outlook: { type: Type.STRING, description: "BULLISH, BEARISH, or NEUTRAL" },
          changePercent: { type: Type.NUMBER },
          topStock: { type: Type.STRING },
          reasoning: { type: Type.STRING },
        },
        propertyOrdering: ["sector", "outlook", "changePercent", "topStock", "reasoning"],
      },
    },
    keyNews: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          headline: { type: Type.STRING },
          impact: { type: Type.STRING },
          sentiment: { type: Type.STRING, description: "positive, negative, or neutral" },
        },
        propertyOrdering: ["headline", "impact", "sentiment"],
      },
    },
  },
  propertyOrdering: [
    "marketSentiment",
    "sentimentReason",
    "intradayPicks",
    "shortTermPicks",
    "longTermPicks",
    "stocksToAvoid",
    "sectorAnalysis",
    "keyNews",
  ],
};

/* ------------------------------------------------------------------ */
/*  Types for stock analysis context                                   */
/* ------------------------------------------------------------------ */

export type StockAnalysisContext = {
  symbol: string;
  quote: Quote;
  indicators: Indicators;
  news: NewsItem[];
  forecast: {
    expectedChangePercent: number;
    expectedPrice: number;
    confidence: number;
  };
  insight: {
    recommendation: string;
    score: number;
    confidence: number;
    working: string[];
    notWorking: string[];
    risks: string[];
    support: number[];
    resistance: number[];
  };
};

export type MarketContext = {
  nifty: { price: number; change: number; changePercent: number };
  sensex: { price: number; change: number; changePercent: number };
  bankNifty: { price: number; change: number; changePercent: number };
  topGainers: Array<{ symbol: string; changePercent: number; price: number }>;
  topLosers: Array<{ symbol: string; changePercent: number; price: number }>;
  sectorPerformance: Array<{ sector: string; changePercent: number }>;
};

/* ------------------------------------------------------------------ */
/*  Build the prompt with all market context                           */
/* ------------------------------------------------------------------ */

function buildAnalysisPrompt(
  stocks: StockAnalysisContext[],
  market: MarketContext,
): string {
  const date = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const marketSection = `
## MARKET OVERVIEW (${date})
- Nifty 50: ₹${market.nifty.price.toFixed(2)} (${market.nifty.changePercent >= 0 ? "+" : ""}${market.nifty.changePercent.toFixed(2)}%)
- Sensex: ₹${market.sensex.price.toFixed(2)} (${market.sensex.changePercent >= 0 ? "+" : ""}${market.sensex.changePercent.toFixed(2)}%)
- Bank Nifty: ₹${market.bankNifty.price.toFixed(2)} (${market.bankNifty.changePercent >= 0 ? "+" : ""}${market.bankNifty.changePercent.toFixed(2)}%)

### Top Gainers
${market.topGainers.map((s) => `- ${s.symbol}: ₹${s.price} (+${s.changePercent.toFixed(2)}%)`).join("\n")}

### Top Losers
${market.topLosers.map((s) => `- ${s.symbol}: ₹${s.price} (${s.changePercent.toFixed(2)}%)`).join("\n")}

### Sector Performance
${market.sectorPerformance.map((s) => `- ${s.sector}: ${s.changePercent >= 0 ? "+" : ""}${s.changePercent.toFixed(2)}%`).join("\n")}
`;

  const stockSections = stocks
    .map(
      (s) => `
### ${s.symbol} (${s.quote.name})
- **Sector**: ${s.quote.sector ?? "N/A"} | **Industry**: ${s.quote.industry ?? "N/A"}
- **Price**: ₹${s.quote.price.toFixed(2)} | **Change**: ${s.quote.changePercent >= 0 ? "+" : ""}${s.quote.changePercent.toFixed(2)}%
- **P/E**: ${s.quote.pe?.toFixed(1) ?? "N/A"} | **EPS**: ${s.quote.eps?.toFixed(2) ?? "N/A"} | **Market Cap**: ${s.quote.marketCap ? `₹${(s.quote.marketCap / 1e7).toFixed(0)} Cr` : "N/A"}
- **52W Range**: ₹${s.quote.fiftyTwoWeekLow ?? "?"} – ₹${s.quote.fiftyTwoWeekHigh ?? "?"}
- **Volume**: ${s.quote.volume.toLocaleString("en-IN")} | **Avg Volume**: ${s.quote.averageVolume?.toLocaleString("en-IN") ?? "N/A"}
- **Beta**: ${s.quote.beta?.toFixed(2) ?? "N/A"} | **Div Yield**: ${s.quote.dividendYield?.toFixed(2) ?? "N/A"}%

**Technical Indicators:**
- RSI(14): ${s.indicators.rsi?.toFixed(1) ?? "N/A"}
- MACD: ${s.indicators.macd?.toFixed(2) ?? "N/A"} | Signal: ${s.indicators.macdSignal?.toFixed(2) ?? "N/A"} | Histogram: ${s.indicators.macdHistogram?.toFixed(2) ?? "N/A"}
- SMA20: ${s.indicators.sma20?.toFixed(2) ?? "N/A"} | SMA50: ${s.indicators.sma50?.toFixed(2) ?? "N/A"} | SMA200: ${s.indicators.sma200?.toFixed(2) ?? "N/A"}
- Bollinger: Upper=${s.indicators.bbUpper?.toFixed(2) ?? "N/A"} | Lower=${s.indicators.bbLower?.toFixed(2) ?? "N/A"}
- ATR%: ${s.indicators.atrPercent?.toFixed(2) ?? "N/A"}% | Realized Vol: ${s.indicators.realizedVol?.toFixed(1) ?? "N/A"}%
- Stochastic K: ${s.indicators.stochasticK?.toFixed(1) ?? "N/A"} | D: ${s.indicators.stochasticD?.toFixed(1) ?? "N/A"}
- Volume Ratio: ${s.indicators.volumeRatio?.toFixed(2) ?? "N/A"}x

**Existing Model Analysis:**
- Recommendation: ${s.insight.recommendation} (Score: ${s.insight.score}, Confidence: ${(s.insight.confidence * 100).toFixed(0)}%)
- Forecast: ${s.forecast.expectedChangePercent >= 0 ? "+" : ""}${s.forecast.expectedChangePercent.toFixed(2)}% expected (Target: ₹${s.forecast.expectedPrice.toFixed(2)}, Confidence: ${(s.forecast.confidence * 100).toFixed(0)}%)
- Support: ${s.insight.support.map((v) => `₹${v.toFixed(2)}`).join(", ") || "N/A"}
- Resistance: ${s.insight.resistance.map((v) => `₹${v.toFixed(2)}`).join(", ") || "N/A"}
- Bullish: ${s.insight.working.join("; ")}
- Bearish: ${s.insight.notWorking.join("; ")}
- Risks: ${s.insight.risks.join("; ")}

**Recent News:**
${s.news.slice(0, 5).map((n) => `- [${n.sentiment.toUpperCase()}] ${n.title}`).join("\n") || "- No recent news"}
`,
    )
    .join("\n---\n");

  return `You are an expert Indian stock market analyst and financial advisor specializing in NSE/BSE equities. You have deep knowledge of Indian market microstructure, FII/DII flows, RBI policies, and sector dynamics.

Today is ${date}. The Indian stock market opens at 9:15 AM IST.

Your task: Analyze the following market data and individual stock data to produce actionable trading recommendations for THREE time horizons:

1. **INTRADAY** — Stocks to trade today with strict entry/exit/stop-loss levels. Focus on liquid large-caps with high volume and clear momentum signals.
2. **SHORT-TERM** (1-2 weeks) — Swing trade ideas based on technical breakouts, sector rotation, or catalyst-driven moves.
3. **LONG-TERM** (3-6 months) — Fundamentally strong stocks with good risk/reward, suitable for positional trades.

Also identify stocks to AVOID and provide sector-level analysis.

Rules:
- All prices in INR (₹)
- Intraday picks must have clear entry, target, and stop-loss
- Short-term targets should be realistic (2-8% upside/downside)
- Long-term picks must have strong fundamentals (reasonable P/E, good EPS growth, healthy balance sheet)
- Be specific about risk levels — LOW, MEDIUM, or HIGH
- Confidence should be 0-100 based on alignment of signals
- Include at least 3 picks per category
- News sentiment should influence your analysis
- Consider sector rotation and market breadth

${marketSection}

## INDIVIDUAL STOCK DATA

${stockSections}

Based on ALL the above data, provide your comprehensive analysis and recommendations.`;
}

/* ------------------------------------------------------------------ */
/*  Main analysis function                                             */
/* ------------------------------------------------------------------ */

export async function runLLMAnalysis(
  stocks: StockAnalysisContext[],
  market: MarketContext,
): Promise<{
  marketSentiment: string;
  sentimentReason: string;
  intradayPicks: StockPick[];
  shortTermPicks: StockPick[];
  longTermPicks: StockPick[];
  stocksToAvoid: Array<{ symbol: string; name: string; reason: string }>;
  sectorAnalysis: SectorAnalysis[];
  keyNews: Array<{ headline: string; impact: string; sentiment: "positive" | "negative" | "neutral" }>;
}> {
  const prompt = buildAnalysisPrompt(stocks, market);

  console.log(`[LLM] Sending analysis request to ${MODEL} with ${stocks.length} stocks...`);
  const startTime = Date.now();

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: analysisResponseSchema,
      temperature: 0.3,
      maxOutputTokens: 8192,
    },
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[LLM] Response received in ${elapsed}s`);

  const text = response.text;
  if (!text) throw new Error("Empty response from Gemini LLM");

  const parsed = JSON.parse(text);

  // Normalize fields
  return {
    marketSentiment: parsed.marketSentiment ?? "NEUTRAL",
    sentimentReason: parsed.sentimentReason ?? "",
    intradayPicks: (parsed.intradayPicks ?? []).map(normalizePick),
    shortTermPicks: (parsed.shortTermPicks ?? []).map(normalizePick),
    longTermPicks: (parsed.longTermPicks ?? []).map(normalizePick),
    stocksToAvoid: parsed.stocksToAvoid ?? [],
    sectorAnalysis: (parsed.sectorAnalysis ?? []).map((s: Record<string, unknown>) => ({
      sector: String(s.sector ?? ""),
      outlook: String(s.outlook ?? "NEUTRAL") as "BULLISH" | "BEARISH" | "NEUTRAL",
      changePercent: Number(s.changePercent ?? 0),
      topStock: String(s.topStock ?? ""),
      reasoning: String(s.reasoning ?? ""),
    })),
    keyNews: (parsed.keyNews ?? []).map((n: Record<string, unknown>) => ({
      headline: String(n.headline ?? ""),
      impact: String(n.impact ?? ""),
      sentiment: (String(n.sentiment ?? "neutral")) as "positive" | "negative" | "neutral",
    })),
  };
}

function normalizePick(raw: Record<string, unknown>): StockPick {
  return {
    symbol: String(raw.symbol ?? ""),
    name: String(raw.name ?? ""),
    sector: String(raw.sector ?? ""),
    currentPrice: Number(raw.currentPrice ?? 0),
    targetPrice: Number(raw.targetPrice ?? 0),
    stopLoss: Number(raw.stopLoss ?? 0),
    recommendation: String(raw.recommendation ?? "HOLD") as "BUY" | "SELL" | "HOLD",
    confidence: Math.min(100, Math.max(0, Number(raw.confidence ?? 50))),
    reasoning: String(raw.reasoning ?? ""),
    technicalSignals: Array.isArray(raw.technicalSignals)
      ? raw.technicalSignals.map(String)
      : [],
    riskLevel: String(raw.riskLevel ?? "MEDIUM") as "LOW" | "MEDIUM" | "HIGH",
  };
}

/* ------------------------------------------------------------------ */
/*  Quick single-stock deep analysis                                   */
/* ------------------------------------------------------------------ */

export async function analyzeStockDeep(context: StockAnalysisContext): Promise<string> {
  const prompt = `You are an expert Indian stock market analyst. Provide a comprehensive deep-dive analysis for ${context.symbol} (${context.quote.name}).

Current Price: ₹${context.quote.price.toFixed(2)}
Change: ${context.quote.changePercent >= 0 ? "+" : ""}${context.quote.changePercent.toFixed(2)}%
P/E: ${context.quote.pe?.toFixed(1) ?? "N/A"} | EPS: ${context.quote.eps?.toFixed(2) ?? "N/A"}
Market Cap: ${context.quote.marketCap ? `₹${(context.quote.marketCap / 1e7).toFixed(0)} Cr` : "N/A"}
RSI: ${context.indicators.rsi?.toFixed(1) ?? "N/A"} | MACD Hist: ${context.indicators.macdHistogram?.toFixed(2) ?? "N/A"}
Support: ${context.insight.support.map((v) => `₹${v.toFixed(2)}`).join(", ") || "N/A"}
Resistance: ${context.insight.resistance.map((v) => `₹${v.toFixed(2)}`).join(", ") || "N/A"}

Recent News:
${context.news.slice(0, 5).map((n) => `- [${n.sentiment}] ${n.title}`).join("\n")}

Provide:
1. Overall assessment (bullish/bearish/neutral with confidence)
2. Key fundamental strengths and weaknesses
3. Technical setup analysis
4. Entry/exit levels for intraday and swing trading
5. Risk factors
6. 1-week and 1-month outlook`;

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: { temperature: 0.3, maxOutputTokens: 2048 },
  });

  return response.text ?? "Analysis unavailable.";
}
