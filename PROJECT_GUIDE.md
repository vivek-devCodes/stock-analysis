# Apex Desk — Project Guide

A guide to how this codebase is organised and how data moves through it. For quick-start instructions, see [README.md](README.md).

---

## 1. What the project is

**Apex Desk** is a stock-analysis app built with Next.js. It has two parts:

1. **Interactive dashboard** (web UI). You search for any Yahoo Finance ticker (`RELIANCE.NS`, `TCS.NS`, `AAPL`, `BTC-USD`, …) and get:
   - A candlestick chart with volume, RSI and MACD panes
   - Technical indicators (SMA/EMA, RSI, MACD, Bollinger Bands, ATR, Stochastic, volatility)
   - A rule-based **BUY / HOLD / SELL** verdict with reasons
   - A statistical price **forecast** with a confidence band
   - News headlines with keyword-based sentiment
   - A watchlist and price/volume **alerts**, stored in the browser
2. **Daily AI report pipeline** (backend job). Before the Indian market opens (8:45 AM IST, Mon–Fri), it:
   - Analyses about 40 NSE stocks across 10 sectors using the same indicator and forecast engine
   - Sends all of that data to **Google Gemini** (`gemini-2.5-flash`) for structured recommendations
   - Emails an HTML report (intraday, short-term and long-term picks, stocks to avoid, sector view, news)

> This is research tooling, not investment advice.

---

## 2. Tech stack

| Area | Technology |
|---|---|
| Framework | **Next.js 16.4** (App Router, Turbopack), **React 19.3**, TypeScript 5 |
| Styling | Tailwind CSS v4 (through `@tailwindcss/turbopack`), Geist fonts |
| Charts | `lightweight-charts` v5 (TradingView) |
| Icons | `lucide-react` |
| LLM | `@google/genai` (Gemini 2.5 Flash, JSON-schema output) |
| Email | `nodemailer` (SMTP; Gmail App Password recommended) |
| Scheduling | `node-cron` |
| Script runner | `tsx`, with `dotenv` for the `.env` file |
| Market data | Yahoo Finance public endpoints (no key needed); NSE unofficial JSON API (scraper exists but isn't used yet) |

> ⚠️ Per [AGENTS.md](AGENTS.md), this Next.js version has breaking changes from older versions. Check `node_modules/next/dist/docs/` before changing framework-level code. [next.config.ts](next.config.ts) turns on `cacheComponents` and `partialPrefetching`.

---

## 3. Folder structure

```
stock-analysis/
├── src/
│   ├── app/
│   │   ├── layout.tsx            # Root layout, fonts, metadata
│   │   ├── page.tsx              # Home → <Dashboard initialSymbol="RELIANCE.NS" />
│   │   ├── globals.css           # Tailwind + theme tokens (dark trading-desk palette)
│   │   └── api/                  # Server route handlers (the backend)
│   │       ├── analyze/route.ts      GET  full analysis for one symbol
│   │       ├── quote/route.ts        GET  lightweight quote (used by alert polling)
│   │       ├── search/route.ts       GET  symbol search / autocomplete
│   │       ├── market/route.ts       GET  index ticker strip (Nifty, Sensex, S&P, BTC…)
│   │       └── daily-report/route.ts GET status / SMTP test, POST run the AI pipeline
│   ├── components/
│   │   ├── Dashboard.tsx         # The whole UI: search, watchlist, analysis panels, alerts, report modal
│   │   └── PriceChart.tsx        # lightweight-charts: price + volume, RSI, MACD panes
│   ├── lib/                      # Pure logic, shared by the API and the daily script
│   │   ├── types.ts              # Shared types: Candle, Quote, Indicators, Insight, Forecast…
│   │   ├── yahoo.ts              # Yahoo Finance client: chart, quoteSummary, search, news + sentiment
│   │   ├── indicators.ts         # SMA, EMA, RSI, MACD, BB, ATR, Stochastic, vol, pivot S/R
│   │   ├── forecast.ts           # Ensemble statistical forecast
│   │   ├── analysis.ts           # Scoring engine → BUY/HOLD/SELL insight
│   │   ├── llm-analyzer.ts       # Gemini prompt + JSON schema for the daily report
│   │   ├── email-template.ts     # DailyReport types + HTML email builder
│   │   ├── email-service.ts      # Nodemailer transport, send + verify
│   │   ├── stock-universe.ts     # Sector → NSE symbol lists, Nifty 50 list
│   │   ├── nse-scraper.ts        # NSE India cookie-based scraper (gainers/losers/sectors) — not used yet
│   │   ├── watchlist.ts          # localStorage helpers (watchlist, alerts, events)
│   │   └── format.ts             # Price/number/percent formatting, clsx
│   └── scripts/
│       └── daily-analysis.ts     # Daily pipeline: run once, --cron, or --test-email
├── generate_stock_analysis_doc.py  # python-docx script that produced Stock_Analysis_System_Documentation.docx
├── test_style.py                   # Small python-docx table-shading test
├── .env.example                    # Required environment variables
└── next.config.ts / tsconfig.json / eslint.config.mjs
```

Path alias: `@/*` → `src/*`.

---

## 4. Running it

```bash
npm install
cp .env.example .env        # fill in the keys you need (see §8)

npm run dev                 # dashboard at http://localhost:3000
npm run build && npm start  # production build

npm run daily-report        # run the AI pipeline once and send the email
npm run daily-report:cron   # long-running scheduler (Mon–Fri 03:15 UTC = 08:45 IST)
npm run test-email          # check the SMTP credentials only
npm run lint
```

The dashboard works **without any API keys**. Only the daily report needs `GEMINI_API_KEY` and the SMTP settings.

---

## 5. Data flow: the dashboard

```
Browser (Dashboard.tsx)
   │  GET /api/analyze?symbol=TCS.NS&range=1y
   ▼
analyze/route.ts
   ├─ yahoo.fetchChart()         → Quote (basic) + Candle[] (OHLCV)
   ├─ yahoo.enrichQuote()        → adds P/E, EPS, market cap, beta, sector…
   ├─ yahoo.fetchNews()          → headlines + keyword sentiment score
   ├─ indicators.computeIndicators(candles)
   ├─ forecast.buildForecast(candles, indicators, horizon)
   └─ analysis.buildInsight(quote, candles, indicators, news, forecast%)
   ▼
AnalyzeResponse JSON → PriceChart + analysis panels
```

**Range → candle interval** (`RANGE_INTERVAL` in [yahoo.ts](src/lib/yahoo.ts)):
`1d→5m`, `5d→15m`, `1mo→1h`, `3mo/6mo/1y/2y→1d`, `5y→1wk`. The forecast horizon is 12 bars for intraday ranges and 10 bars otherwise.

**Other client loops in Dashboard.tsx:**
- `/api/market` refreshes the index strip every **60 s**.
- `/api/search` gives debounced autocomplete.
- **Alert polling** runs every **45 s**. It calls `/api/quote` for each symbol that has an enabled rule, evaluates the rules, and applies a 15-minute cooldown per rule. A triggered rule logs an event and shows a browser `Notification` if you've granted permission.
- The watchlist, alert rules and alert events live in `localStorage` (`apex-watchlist`, `apex-alerts`, `apex-alert-events`).

---

## 6. The analysis engine (in `src/lib`)

### 6.1 Indicators — [indicators.ts](src/lib/indicators.ts)
SMA 20/50/200, EMA 12/26, RSI 14 (Wilder smoothing), MACD (12,26,9), Bollinger (20, 2σ), ATR 14 and ATR%, Stochastic (14,3,3), volume ratio against the 20-period average, and 21-bar realized volatility (annualised over 252 trading days).
`pivotLevels()` finds swing highs and lows over the last 80 bars, groups levels within 1.2% of each other, and returns the 3 nearest support and 3 nearest resistance levels.

### 6.2 Scoring → recommendation — [analysis.ts](src/lib/analysis.ts)
Each rule adds to or subtracts from a running score:

| Signal | Points |
|---|---|
| Price > SMA20 > SMA50 (or the reverse) | ±14 |
| Price above / below SMA200 | ±8 |
| RSI ≥ 70 / ≤ 30 / ≥ 55 / ≤ 45 | −10 / +8 / +6 / −6 |
| MACD histogram > 0 / < 0 | ±8 |
| Volume > 1.6× average | ±4 (in the direction of the day's move) |
| Realized vol > 45% | −4 |
| Sum of news sentiment > 1 / < −1 | ±6 |
| Forecast drift > +1.5% / < −1.5% | ±8 |

`score ≥ 18 → BUY`, `score ≤ −18 → SELL`, anything else is `HOLD`. Confidence = `clamp(0.42 + |score|/90, 0.32, 0.86)`.
Signals are sorted by tone into the **What is working / What is not / Risks** lists. Extra risk notes appear for P/E > 45, missing support, and price within 2% of resistance.

### 6.3 Forecast — [forecast.ts](src/lib/forecast.ts)
This is a statistical ensemble ("inspired by Kronos", with no ML model weights) over the last ≤120 candles:
- Log-linear regression trend (slope, R²)
- AR(1) term on log-returns (φ clamped to ±0.6)
- Momentum bias from RSI and MACD; mean-reversion bias toward SMA50
- Bands from return percentiles (10th/90th) plus σ·√h, widened by ATR%

The output is a mean/low/high path, the expected % change, and a confidence between 0.28 and 0.78.

### 6.4 News sentiment — [yahoo.ts](src/lib/yahoo.ts)
A simple keyword count on each headline: +1 for each positive word (surge, beat, upgrade…) and −1 for each negative word (miss, downgrade, fraud…).

---

## 7. Data flow: the daily AI report

[src/scripts/daily-analysis.ts](src/scripts/daily-analysis.ts) → `runDailyAnalysis()`

1. **Market context**: Nifty, Sensex and Bank Nifty prices from Yahoo (`fetchIndexQuotes`).
2. **Stock selection**: the first 4 symbols of each of the 10 sectors in [stock-universe.ts](src/lib/stock-universe.ts), about 40 stocks after removing duplicates.
3. **Per-stock analysis**: the same pipeline as `/api/analyze`, run in batches of 8 with a 2-second pause between batches.
4. **LLM step**: [llm-analyzer.ts](src/lib/llm-analyzer.ts) builds one large markdown prompt (market overview plus every stock's fundamentals, indicators, model verdict and news) and calls Gemini with a strict JSON `responseJsonSchema` at temperature 0.3. The response is normalised into `StockPick[]` and related types.
5. **Report**: a `DailyReport` object is built and rendered by [email-template.ts](src/lib/email-template.ts) into an email-safe dark HTML layout, with a plain-text fallback.
6. **Send**: [email-service.ts](src/lib/email-service.ts) sends to `REPORT_RECIPIENTS` over SMTP.

There are three ways to start it:
- CLI: `npm run daily-report` (runs once) or `npm run daily-report:cron` (keeps running on a schedule)
- HTTP: `POST /api/daily-report` (the Dashboard's "AI Stock Recommendation Dispatcher" modal calls this)
- SMTP check only: `GET /api/daily-report?action=test-email` or `npm run test-email`

---

## 8. Environment variables (`.env`)

| Variable | Needed for | Notes |
|---|---|---|
| `GEMINI_API_KEY` | Daily report | Google AI Studio key |
| `SMTP_HOST`, `SMTP_PORT` | Daily report | Defaults: `smtp.gmail.com`, `587` (465 switches on TLS) |
| `SMTP_USER`, `SMTP_PASS` | Daily report | For Gmail, use an **App Password** |
| `REPORT_RECIPIENTS` | Daily report | Comma-separated email addresses |
| `FINNHUB_API_KEY`, `NEWS_API_KEY`, `ALPHA_VANTAGE_API_KEY` | — | Listed in the template, but **no code reads them yet** |

---

## 9. API reference

| Method & path | Params | Returns |
|---|---|---|
| `GET /api/analyze` | `symbol` (required), `range` (`1d`…`5y`, default `1y`) | `AnalyzeResponse`; 400 for bad input, 422 if there are < 15 candles, 502 if Yahoo fails |
| `GET /api/quote` | `symbol` | `{ quote }` (5-day chart meta) |
| `GET /api/search` | `q` | `{ results: SearchResult[] }` |
| `GET /api/market` | — | `{ indices, asOf }` for ^NSEI, ^BSESN, ^NSEBANK, ^GSPC, ^IXIC, ^DJI, BTC-USD |
| `GET /api/daily-report` | `action=test-email` (optional) | Status info or the SMTP check result |
| `POST /api/daily-report` | — | Runs the full pipeline and returns `{ success, report }` |

---

## 10. Known gaps and things to watch

These came up while reading the code. They're useful context before you change anything.

- **`nse-scraper.ts` is never imported.** The daily report's `topGainers`, `topLosers` and `sectorPerformance` are always empty arrays, so Gemini gets no breadth data. The index `change` field is also hard-coded to `0`, so the email's index cards show a ▲ 0.00 absolute change.
- **`analyzeStockDeep()`** in `llm-analyzer.ts` is exported but nothing calls it.
- **Alert type `news`** is defined in `AlertRule` but never evaluated. **`volatility_spike`** uses the same check as `pct_change`.
- **`POST /api/daily-report` has no authentication.** Anyone who can reach the server can trigger a Gemini call and an email send.
- **Cron runs in-process** (`node-cron`). The machine has to be awake and the process running at 03:15 UTC. Deploying to a serverless host would need an external scheduler that calls the POST route.
- **Data source fragility**: Yahoo and NSE endpoints are unofficial, and NSE needs browser-like headers and cookies. Both can break or rate-limit without warning.
- `stock-universe.ts`: the "Infra" sector includes `LTTS.NS` (an IT services firm), and `MARKET_INDICES` / `getStocksBySector` aren't used.
- `generate_stock_analysis_doc.py` and `test_style.py` are standalone Python helpers for the `.docx` documentation. The app doesn't use them.
