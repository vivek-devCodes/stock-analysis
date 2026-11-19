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
   - A watchlist (saved in the database) and price/volume **alerts** (stored in the browser)
2. **Morning report** (automatic email). Every weekday before the open (08:10–08:35 IST), it emails:
   - Index snapshot (NIFTY 50, SENSEX, BANK NIFTY, INDIA VIX) and the market regime
   - Today's intraday trade plan (built overnight from NSE end-of-day data)
   - The AI Analyst's approved calls from the pre-market scan
   - Every watchlist stock: last price, rule-based signal, RSI, trend, support / resistance

Everything is computed by the app's own rules. **No external AI service (Gemini, ChatGPT, Claude…) and no AI API key is used.**

> This is research tooling, not investment advice.

---

## 2. Tech stack

| Area | Technology |
|---|---|
| Framework | **Next.js 16.4** (App Router, Turbopack), **React 19.3**, TypeScript 5 |
| Styling | Tailwind CSS v4 (through `@tailwindcss/turbopack`), Geist fonts |
| Charts | `lightweight-charts` v5 (TradingView) |
| Icons | `lucide-react` |
| Email | `nodemailer` (SMTP; Gmail App Password recommended) |
| Scheduling | Vercel Cron + GitHub Actions (see §7) |
| Script runner | `tsx`, with `dotenv` for the `.env` file |
| Market data | Yahoo Finance public endpoints (no key needed); NSE live market server (free, no key); NSE / BSE official end-of-day report files (see §12) |

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
│   │       ├── watchlist/route.ts    GET/PUT the saved watchlist (read by the morning report)
│   │       ├── morning-report/route.ts GET preview / status, POST send now
│   │       └── cron/morning-report/  the scheduled 08:30 IST email
│   ├── components/
│   │   ├── Dashboard.tsx         # The whole UI: search, watchlist, analysis panels, alerts
│   │   └── PriceChart.tsx        # lightweight-charts: price + volume, RSI, MACD panes
│   ├── lib/                      # Pure logic, shared by the API and the daily script
│   │   ├── types.ts              # Shared types: Candle, Quote, Indicators, Insight, Forecast…
│   │   ├── yahoo.ts              # Yahoo Finance client: chart, quoteSummary, search, news + sentiment
│   │   ├── indicators.ts         # SMA, EMA, RSI, MACD, BB, ATR, Stochastic, vol, pivot S/R
│   │   ├── forecast.ts           # Ensemble statistical forecast
│   │   ├── analysis.ts           # Scoring engine → BUY/HOLD/SELL insight
│   │   ├── reports/morning.ts    # Morning report: data collection + email layout
│   │   ├── reports/morning-run.ts # Once-a-day send, preview, history
│   │   ├── watchlist-store.ts    # Server-side watchlist (DB → WATCHLIST_SYMBOLS → default)
│   │   ├── email-service.ts      # Nodemailer transport, send + verify, readable SMTP errors
│   │   ├── stock-universe.ts     # Sector → NSE symbol lists, Nifty 50 list
│   │   ├── watchlist.ts          # localStorage helpers (browser copy of the watchlist, alerts, events)
│   │   └── format.ts             # Price/number/percent formatting, clsx
│   └── scripts/
│       └── test-email.ts         # npm run test-email: check the SMTP settings
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

npm run test-email          # check the SMTP credentials only
npm run lint
```

The app needs **no API keys**. Only the emails need the SMTP settings.

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

## 7. The morning report (08:30 IST email)

[reports/morning.ts](src/lib/reports/morning.ts) and [reports/morning-run.ts](src/lib/reports/morning-run.ts)

1. **Pre-market scan**: runs the AI Analyst's pre-market session (rule-based agents, no external AI).
2. **Data**: index quotes, today's intraday plan (built the night before from NSE files), the approved agent calls, and the saved watchlist. Each watchlist stock goes through the same indicator and scoring engine as `/analyze`.
3. **Layout**: an email-safe light HTML layout (header, index tiles, plan table, agent calls, watchlist table, yesterday's paper-trading result) with a plain-text fallback.
4. **Send once**: `morning_reports` holds one row per day. The first trigger claims it and later triggers skip. A failed send can be retried by the next trigger.

**Schedule (Mon–Fri):** GitHub Actions ([morning-report.yml](.github/workflows/morning-report.yml)) at 08:10 and 08:35 IST is the main trigger, because Vercel's free plan may run a cron any time within its hour. Vercel Cron (`0 3 * * 1-5` = 08:30 IST) is the backup. GitHub needs the repository secrets `APEX_APP_URL` and `APEX_CRON_SECRET` (the same value as Vercel's `CRON_SECRET`).

**Watchlist:** the Stock Analyzer page saves every change to the `watchlist` table through `PUT /api/watchlist`. The first time it loads, it uploads the list already in the browser.

**By hand:** open `/api/morning-report` to preview today's report in the browser (nothing is sent). `POST /api/morning-report` sends it now. `/api/morning-report?view=status` shows recent sends and checks the email settings.

---

## 8. Environment variables (`.env`)

| Variable | Needed for | Notes |
|---|---|---|
| `SMTP_HOST`, `SMTP_PORT` | All emails | Defaults: `smtp.gmail.com`, `587` (465 switches on TLS) |
| `SMTP_USER`, `SMTP_PASS` | All emails | For Gmail, use an **App Password** (not your normal password) |
| `REPORT_RECIPIENTS` | All emails | Comma-separated email addresses |
| `WATCHLIST_SYMBOLS` | Morning report | Optional fallback until a watchlist is saved |
| `FINNHUB_API_KEY`, `NEWS_API_KEY`, `ALPHA_VANTAGE_API_KEY` | — | Listed in the template, but **no code reads them yet** |

---

## 9. API reference

| Method & path | Params | Returns |
|---|---|---|
| `GET /api/analyze` | `symbol` (required), `range` (`1d`…`5y`, default `1y`) | `AnalyzeResponse`; 400 for bad input, 422 if there are < 15 candles, 502 if Yahoo fails |
| `GET /api/quote` | `symbol` | `{ quote }` (5-day chart meta) |
| `GET /api/search` | `q` | `{ results: SearchResult[] }` |
| `GET /api/market` | — | `{ indices, asOf }` for ^NSEI, ^BSESN, ^NSEBANK, ^GSPC, ^IXIC, ^DJI, BTC-USD |
| `GET/PUT /api/watchlist` | `{ symbols }` on PUT | The saved watchlist |
| `GET /api/morning-report` | `view=status` (optional) | Today's report as HTML, or send history + SMTP check |
| `POST /api/morning-report` | — | Sends the morning report now |

---

## 10. Known gaps and things to watch

These came up while reading the code. They're useful context before you change anything.

- **Alert type `news`** is defined in `AlertRule` but never evaluated. **`volatility_spike`** uses the same check as `pct_change`.
- **Data source fragility**: Yahoo and NSE endpoints are unofficial, and NSE needs browser-like headers and cookies. Both can break or rate-limit without warning.
- `stock-universe.ts`: the "Infra" sector includes `LTTS.NS` (an IT services firm), and `MARKET_INDICES` / `getStocksBySector` aren't used.
- `generate_stock_analysis_doc.py` and `test_style.py` are standalone Python helpers for the `.docx` documentation. The app doesn't use them.

---

## 11. Paper trading (`/paper-trading`)

Tests whether the AI agent's **intraday** calls are actually right, with no real money.

**How a trade is opened** — [src/lib/paper/engine.ts](src/lib/paper/engine.ts)
1. Between **09:30 and 14:30 IST** on market days, the intraday scanner shortlists the strongest setups (`shortlist("intraday")`).
2. Each one runs through the full multi-agent pipeline (`runAnalysis`, horizon `intraday`).
3. Every **BUY / SELL / WATCHLIST** call is entered immediately at the live price, using the agent's own stop and first target. Size: ₹1,00,000 capital, 1% risk per trade.
4. Directional setups the agent rejected (**NO TRADE**) are tracked as **shadow** trades. They're excluded from the headline numbers and only measure whether rejecting them was right.

**What triggers it:** the Vercel cron `/api/cron/paper-trade` (Mon–Fri, ~09:35 IST); the page's **Auto-trade** switch, which runs once per day while the page is open and retries every 30 minutes if nothing was entered; or the **Run agent now** button. A stock is traded at most once per day.

**How a trade is closed** — [src/lib/paper/rules.ts](src/lib/paper/rules.ts), tested by `npm run test:paper`
- 5-minute candles after entry are replayed. The trade exits at the target or the stop-loss, whichever is reached first, otherwise it's squared off at **15:15 IST**.
- Fills are conservative: if one candle touches both levels, the stop counts first, and a gap past the stop exits at the worse open price.
- P&L is after a 0.1% round-trip cost. A trade is **correct** when its net P&L is above zero.

**Scoring** — [src/lib/paper/stats.ts](src/lib/paper/stats.ts): win rate, target/stop/square-off counts, net P&L, total profit and loss, profit factor and expectancy, split by verdict and side. Each specialist agent (technical, market, news…) is also scored on whether its bullish or bearish view matched the actual price move.

**Storage:** the `paper_trades` and `paper_runs` tables when `DATABASE_URL` is set. Otherwise trades are kept in server memory, which is lost on restart; the page warns about this.

---

## 12. NSE / BSE exchange data (`/market-data`) and the next-session intraday plan

### Where the data comes from
Every exchange dataset is an **official public file** published by NSE or BSE (the same files behind
*Market Data → Daily Reports* on nseindia.com and the BSE bhavcopy page). They are downloaded
directly with an honest user agent — no cookies, no scraping of web pages, no API key, no paid
service. The catalogue, with the NSE page each file corresponds to, is in
[src/lib/exchange/catalog.ts](src/lib/exchange/catalog.ts).

| NSE / BSE page | File | Used for |
|---|---|---|
| Equity › Daily Reports (security-wise delivery) | `sec_bhavdata_full_DDMMYYYY.csv` | delivery %, volume, breadth, gainers/losers, most active |
| Derivatives › Option Chain / Change in OI / Most Active (end of day) | `BhavCopy_NSE_FO_…csv.zip` | futures build-up, PCR, max pain, OI support/resistance, ATM IV + Greeks (Black–Scholes), OI spurts |
| Equity › Price Bands & Surveillance Actions | `sec_list.csv` | price band, GSM stage, circuit hits |
| Derivatives › Securities in ban period | `fo_secban.csv` | F&O ban |
| Equity › Large Deals | `bulk.csv`, `block.csv` | bulk / block deals (two-way HFT churn is ignored) |
| Equity › Indices | `ind_close_all_DDMMYYYY.csv` | index close, P/E, P/B |
| Equity › 52 Week High/Low | `CM_52_wk_High_low_DDMMYYYY.csv` | 52-week levels (corporate-action adjusted) |
| Securities Available For Trading / F&O lot sizes | `EQUITY_L.csv`, `fo_mktlots.csv` | universe, F&O membership, lot size |
| NSE Clearing › Volatility | `FOVOLT_DDMMYYYY.csv` | annualised volatility |
| Derivatives › Participant-wise OI | `fao_participant_oi_DDMMYYYY.csv` | FII / DII / Pro / Client index-futures positioning |
| BSE › Equity Bhavcopy | `BhavCopy_BSE_CM_…CSV` | BSE volume / close |
| NSE live market server (`mcp.nseindia.in`, free, no key) | — | live quotes, live movers |

**Not used:** NSE's *live* option chain, pre-open screen, holiday list and corporate-action pages are
served only through its cookie-protected website API, so they are deliberately not accessed.
Instead: option analytics come from the end-of-day F&O bhavcopy, the opening gap is measured at
09:15 from the live feed, holidays are detected from whether NSE published a bhavcopy, and
results / ex-dividend dates come from Yahoo Finance.

### Code
- `src/lib/exchange/parse.ts`, `fno.ts`, `greeks.ts`, `build.ts`, `interpret.ts` — **pure**, tested by `npm run test:exchange`.
- `src/lib/exchange/fetch.ts` — downloads (+ a tiny ZIP reader), latest published trading day.
- `src/lib/exchange/store.ts` — Postgres tables `exchange_days` / `exchange_stocks` (40 sessions kept;
  full records for the last 10), a 10-session history for delivery/volume averages (back-filled on
  the first run), in-memory cache. A day built before all files were published is rebuilt later.
- `interpret.ts` turns a stock's data into labelled signals (bullish / bearish / risk / info, each
  with its source). The **same** signals drive the agents and the analyzer panel. Thresholds live
  in `THRESHOLDS.exchange` ([thresholds.ts](src/lib/agents/thresholds.ts)).

### How the agents use it
- **Futures & Options agent** — build-up, PCR, OI walls, IV (evidence only; no options strategy).
- **Ownership & Flows agent** — delivery vs average (accumulation / distribution), volume spike, deals, 52-week position.
- **Market agent** — breadth (advances ÷ declines), FII index-futures long %, NIFTY PCR.
- **Risk agent vetoes** — GSM (all horizons); trade-to-trade series, ≤ 5% price band, a circuit hit, or results due today/next session (intraday). F&O ban, high volatility, low-delivery moves, rich IV and ex-dividend are warnings.

### The agent's day (intraday focus)
| When (IST, Mon–Fri) | What | Where |
|---|---|---|
| 09:30–15:00, every 30 min | intraday scan; paper-trade run (executes **last night's plan first**, then the live agent's calls once a day); settles open trades | GitHub Actions → `/api/cron/agent-scan`, `/api/cron/paper-trade`; Vercel cron 09:35 |
| 15:15 | every paper trade squared off (replayed from 5-min candles) | `paper/rules.ts` |
| 19:15 | **nightly**: daily report (emailed) → download today's NSE/BSE files → build tomorrow's plan (screen → drop restricted stocks → re-rank with exchange data → full multi-agent analysis on the best 6) | Vercel cron → `/api/cron/nightly` |
| 21:00 | backup of the nightly job (NSE sometimes publishes the F&O file late); every step is idempotent | GitHub Actions `agent-nightly.yml` |

At the open a planned trade is **skipped** if the price gapped through the stop or the target, or
already covered ≥ 50% of the way to the target (no chasing). Plans older than 4 days expire.
The Paper Trading page shows the pending plan (with the exchange evidence behind each idea), how it
was executed, and the daily reports ("was the agent right?").

