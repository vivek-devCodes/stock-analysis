# Apex Desk — Stock Analysis

Professional Next.js dashboard for symbol lookup, OHLCV charts, technical indicators, probabilistic forecasts, news sentiment, and local alerts.

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Search any Yahoo-listed ticker (`RELIANCE.NS`, `TCS.NS`, `AAPL`, `BTC-USD`).

## Data

Market quotes, history, and news are proxied from Yahoo Finance. Indian cash-market names use `.NS` (NSE) and `.BO` (BSE). Official NSE, Zerodha Kite, and Groww APIs need broker credentials and are not bundled.

Forecasts blend log-linear trend, AR(1) residuals, RSI/MACD momentum, and SMA mean-reversion on K-line (OHLCV) data — the same market “language” used by [Kronos](https://github.com/shiyu-coder/Kronos), without loading transformer weights. Ranges are probabilistic, not guaranteed.

Alerts live in the browser (`localStorage`) and poll quotes every 45 seconds.

This is research tooling, not investment advice.
