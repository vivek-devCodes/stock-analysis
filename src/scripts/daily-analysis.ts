/**
 * Daily Stock Analysis — Automated Pipeline
 *
 * This script runs daily at 8:45 AM IST (before market opens at 9:15 AM).
 * It collects data from NSE/Yahoo Finance, runs LLM analysis via Gemini,
 * and sends an email with actionable recommendations.
 *
 * Usage:
 *   npx tsx src/scripts/daily-analysis.ts          # Run once
 *   npx tsx src/scripts/daily-analysis.ts --cron   # Run as cron daemon
 */

import * as cron from "node-cron";
import { fetchChart, enrichQuote, fetchNews, fetchIndexQuotes } from "../lib/yahoo";
import { computeIndicators } from "../lib/indicators";
import { buildForecast } from "../lib/forecast";
import { buildInsight, newsSentiment } from "../lib/analysis";
import { runLLMAnalysis, type StockAnalysisContext, type MarketContext } from "../lib/llm-analyzer";
import { sendDailyReport, testEmailConnection } from "../lib/email-service";
import { getAllStocks, SECTORS } from "../lib/stock-universe";
import type { DailyReport } from "../lib/email-template";

/* ------------------------------------------------------------------ */
/*  Configuration                                                      */
/* ------------------------------------------------------------------ */

// Max stocks to analyze in each batch (to manage API rate limits)
const BATCH_SIZE = 8;
const BATCH_DELAY_MS = 2000;

// Top stocks per sector to analyze (picks the most traded from each sector)
const STOCKS_PER_SECTOR = 4;

// Schedule: 8:45 AM IST = 3:15 AM UTC (IST = UTC + 5:30)
const CRON_SCHEDULE = "15 3 * * 1-5"; // Mon-Fri at 3:15 UTC = 8:45 IST

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function log(message: string) {
  const time = new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" });
  console.log(`[${time}] ${message}`);
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ------------------------------------------------------------------ */
/*  Core: Analyze a single stock                                       */
/* ------------------------------------------------------------------ */

async function analyzeStock(symbol: string): Promise<StockAnalysisContext | null> {
  try {
    const { quote: rawQuote, candles } = await fetchChart(symbol, "1y");
    if (candles.length < 15) return null;

    const [quote, news] = await Promise.all([enrichQuote(rawQuote), fetchNews(symbol, rawQuote.name)]);
    const indicators = computeIndicators(candles);
    const forecast = buildForecast(candles, indicators, 10);
    const insight = buildInsight(quote, candles, indicators, news, forecast.expectedChangePercent);

    return {
      symbol,
      quote,
      indicators,
      news,
      forecast: {
        expectedChangePercent: forecast.expectedChangePercent,
        expectedPrice: forecast.expectedPrice,
        confidence: forecast.confidence,
      },
      insight: {
        recommendation: insight.recommendation,
        score: insight.score,
        confidence: insight.confidence,
        working: insight.working,
        notWorking: insight.notWorking,
        risks: insight.risks,
        support: insight.support,
        resistance: insight.resistance,
      },
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log(`⚠ Failed to analyze ${symbol}: ${msg}`);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Core: Gather market overview data                                  */
/* ------------------------------------------------------------------ */

async function getMarketContext(): Promise<MarketContext> {
  log("📊 Fetching market overview...");

  const indexQuotes = await fetchIndexQuotes(["^NSEI", "^BSESN", "^NSEBANK"]);

  const nifty = indexQuotes.find((q) => q.symbol.includes("NSEI")) ?? {
    symbol: "^NSEI",
    name: "Nifty 50",
    price: 0,
    changePercent: 0,
  };
  const sensex = indexQuotes.find((q) => q.symbol.includes("BSESN")) ?? {
    symbol: "^BSESN",
    name: "Sensex",
    price: 0,
    changePercent: 0,
  };
  const bankNifty = indexQuotes.find((q) => q.symbol.includes("NSEBANK")) ?? {
    symbol: "^NSEBANK",
    name: "Bank Nifty",
    price: 0,
    changePercent: 0,
  };

  return {
    nifty: { price: nifty.price, change: 0, changePercent: nifty.changePercent },
    sensex: { price: sensex.price, change: 0, changePercent: sensex.changePercent },
    bankNifty: { price: bankNifty.price, change: 0, changePercent: bankNifty.changePercent },
    topGainers: [],
    topLosers: [],
    sectorPerformance: [],
  };
}

/* ------------------------------------------------------------------ */
/*  Core: Select diverse stocks to analyze                             */
/* ------------------------------------------------------------------ */

function selectStocksForAnalysis(): string[] {
  const selected: string[] = [];

  // Pick top stocks from each sector
  for (const [, stocks] of Object.entries(SECTORS)) {
    const pick = stocks.slice(0, STOCKS_PER_SECTOR);
    selected.push(...pick);
  }

  // Deduplicate
  return [...new Set(selected)];
}

/* ------------------------------------------------------------------ */
/*  Main pipeline                                                      */
/* ------------------------------------------------------------------ */

export async function runDailyAnalysis(): Promise<DailyReport> {
  const startTime = Date.now();
  log("🚀 Starting daily stock analysis pipeline...");

  // Step 1: Market overview
  const market = await getMarketContext();
  log(`✅ Market: Nifty=${market.nifty.price.toFixed(2)} (${market.nifty.changePercent >= 0 ? "+" : ""}${market.nifty.changePercent.toFixed(2)}%)`);

  // Step 2: Select and analyze stocks
  const stockList = selectStocksForAnalysis();
  log(`📋 Analyzing ${stockList.length} stocks across ${Object.keys(SECTORS).length} sectors...`);

  const allAnalysis: StockAnalysisContext[] = [];

  for (let i = 0; i < stockList.length; i += BATCH_SIZE) {
    const batch = stockList.slice(i, i + BATCH_SIZE);
    log(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.join(", ")}`);

    const results = await Promise.allSettled(batch.map(analyzeStock));

    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        allAnalysis.push(result.value);
      }
    }

    if (i + BATCH_SIZE < stockList.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  log(`✅ Analyzed ${allAnalysis.length}/${stockList.length} stocks successfully.`);

  // Step 3: Run LLM analysis
  log("🤖 Running Gemini LLM deep analysis...");
  const llmResult = await runLLMAnalysis(allAnalysis, market);
  log(`✅ LLM analysis complete: ${llmResult.marketSentiment} sentiment`);

  // Step 4: Build report
  const date = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Kolkata",
  });

  const report: DailyReport = {
    date,
    marketOverview: {
      nifty: market.nifty,
      sensex: market.sensex,
      bankNifty: market.bankNifty,
      marketSentiment: llmResult.marketSentiment as "BULLISH" | "BEARISH" | "NEUTRAL",
      sentimentReason: llmResult.sentimentReason,
    },
    intradayPicks: llmResult.intradayPicks,
    shortTermPicks: llmResult.shortTermPicks,
    longTermPicks: llmResult.longTermPicks,
    stocksToAvoid: llmResult.stocksToAvoid,
    sectorAnalysis: llmResult.sectorAnalysis,
    keyNews: llmResult.keyNews,
    disclaimer:
      "DISCLAIMER: This report is generated by an AI system using publicly available market data. " +
      "It is intended for educational and informational purposes only. This is NOT investment advice. " +
      "Past performance does not guarantee future results. Always consult a SEBI-registered financial " +
      "advisor before making investment decisions. Trading in stocks involves risk of loss. " +
      "The authors are not responsible for any financial losses incurred based on this report.",
  };

  // Step 5: Send email
  log("📧 Sending report via email...");
  const emailResult = await sendDailyReport(report);

  if (emailResult.success) {
    log(`✅ Email sent successfully! Message ID: ${emailResult.messageId}`);
  } else {
    log(`❌ Email failed: ${emailResult.error}`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log(`🏁 Pipeline complete in ${elapsed}s`);

  return report;
}

/* ------------------------------------------------------------------ */
/*  CLI entry point                                                    */
/* ------------------------------------------------------------------ */

async function main() {
  // Load .env file
  const { config } = await import("dotenv").catch(() => ({ config: () => {} }));
  if (typeof config === "function") {
    config();
  }

  const args = process.argv.slice(2);

  if (args.includes("--test-email")) {
    log("Testing email connection...");
    const ok = await testEmailConnection();
    process.exit(ok ? 0 : 1);
  }

  if (args.includes("--cron")) {
    log(`⏰ Cron mode: scheduling daily at 8:45 AM IST (${CRON_SCHEDULE} UTC)`);
    log("Press Ctrl+C to stop.\n");

    cron.schedule(
      CRON_SCHEDULE,
      async () => {
        log("⏰ Cron triggered! Running daily analysis...");
        try {
          await runDailyAnalysis();
        } catch (error) {
          log(`❌ Pipeline error: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
      { timezone: "UTC" },
    );

    // Keep process alive
    process.on("SIGINT", () => {
      log("Shutting down scheduler...");
      process.exit(0);
    });

    return;
  }

  // Default: run once
  try {
    await runDailyAnalysis();
  } catch (error) {
    log(`❌ Fatal error: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack) console.error(error.stack);
    process.exit(1);
  }
}

const isDirectCli =
  typeof process !== "undefined" &&
  process.argv &&
  process.argv[1] &&
  (process.argv[1].endsWith("daily-analysis.ts") ||
    process.argv[1].endsWith("daily-analysis.js") ||
    process.argv[1].includes("daily-analysis"));

if (isDirectCli) {
  void main();
}
