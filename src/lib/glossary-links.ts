// Maps metric labels shown around the app to the glossary search that explains them.
// Kept tiny on purpose so dashboards don't ship the whole glossary.

const LINKS: Record<string, string> = {
  "P/E": "P/E",
  "P/B": "P/B",
  EPS: "EPS",
  Beta: "Beta",
  "Mkt cap": "Market Capitalization",
  "M.Cap ₹Cr": "Market Capitalization",
  ROE: "ROE",
  "Debt/Eq": "D/E",
  "Net margin": "Net Profit Margin",
  "Div yield": "Dividend Yield",
  "Promoter*": "Promoter Holding",
  RSI: "RSI",
  "RSI 15m": "RSI",
  ADX: "ADX",
  ATR: "ATR",
  "ATR %": "ATR",
  "ATR 15m": "ATR",
  "RV (ann.)": "Historical Volatility",
  Volatility: "Historical Volatility",
  "Vol ratio": "Relative Volume",
  "Rel. vol": "Relative Volume",
  "vs VWAP": "VWAP",
  CPR: "CPR",
  "PDH / PDL": "Previous Day High",
  Gap: "Gap Up",
  "52W high": "52",
  "52W low": "52",
  "Hit rate": "Hit Rate",
  "Profit factor": "Profit Factor",
  "Per trade, after costs": "Expectancy",
  "Reward : risk": "Risk/Reward",
  "ATM strike": "ATM",
  "Strike step": "Strike Interval",
};

export function glossaryHref(label: string): string | null {
  const q = LINKS[label];
  return q ? `/glossary?q=${encodeURIComponent(q)}` : null;
}
