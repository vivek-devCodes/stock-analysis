/**
 * Stock Universe — defines the universe of Indian stocks to analyze daily.
 *
 * All symbols use the Yahoo Finance `.NS` suffix for NSE-listed equities.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A market index descriptor. */
export interface MarketIndex {
  symbol: string;
  name: string;
  type: "broad" | "sectoral";
}

/** Sector name literals. */
export type SectorName =
  | "Banking"
  | "IT"
  | "Pharma"
  | "Auto"
  | "FMCG"
  | "Energy"
  | "Metal"
  | "Realty"
  | "Infra"
  | "Finance";

// ---------------------------------------------------------------------------
// Sector → Stocks mapping
// ---------------------------------------------------------------------------

export const SECTORS: Record<SectorName, string[]> = {
  Banking: [
    "HDFCBANK.NS",
    "ICICIBANK.NS",
    "SBIN.NS",
    "KOTAKBANK.NS",
    "AXISBANK.NS",
    "BANKBARODA.NS",
    "PNB.NS",
    "INDUSINDBK.NS",
  ],
  IT: [
    "TCS.NS",
    "INFY.NS",
    "WIPRO.NS",
    "HCLTECH.NS",
    "TECHM.NS",
    "LTM.NS", // LTIMindtree, renamed LTM
    "PERSISTENT.NS",
    "COFORGE.NS",
  ],
  Pharma: [
    "SUNPHARMA.NS",
    "DRREDDY.NS",
    "CIPLA.NS",
    "DIVISLAB.NS",
    "APOLLOHOSP.NS",
    "BIOCON.NS",
  ],
  Auto: [
    "MARUTI.NS",
    "TMPV.NS", // Tata Motors Passenger Vehicles (demerged)

    "TMCV.NS", // Tata Motors commercial vehicles
    "M&M.NS",
    "BAJAJ-AUTO.NS",
    "HEROMOTOCO.NS",
    "EICHERMOT.NS",
  ],
  FMCG: [
    "HINDUNILVR.NS",
    "ITC.NS",
    "NESTLEIND.NS",
    "BRITANNIA.NS",
    "DABUR.NS",
    "COLPAL.NS",
    "GODREJCP.NS",
  ],
  Energy: [
    "RELIANCE.NS",
    "ONGC.NS",
    "NTPC.NS",
    "POWERGRID.NS",
    "ADANIGREEN.NS",
    "TATAPOWER.NS",
  ],
  Metal: [
    "TATASTEEL.NS",
    "HINDALCO.NS",
    "JSWSTEEL.NS",
    "COALINDIA.NS",
    "VEDL.NS",
  ],
  Realty: [
    "DLF.NS",
    "GODREJPROP.NS",
    "OBEROIRLTY.NS",
    "PRESTIGE.NS",
  ],
  Infra: [
    "LTTS.NS",
    "LT.NS",
    "ADANIENT.NS",
    "ADANIPORTS.NS",
  ],
  Finance: [
    "BAJFINANCE.NS",
    "BAJAJFINSV.NS",
    "HDFCLIFE.NS",
    "SBILIFE.NS",
    "ICICIPRULI.NS",
  ],
};

// ---------------------------------------------------------------------------
// Nifty 50 components
// ---------------------------------------------------------------------------

export const NIFTY_50: string[] = [
  "ADANIENT.NS",
  "ADANIPORTS.NS",
  "APOLLOHOSP.NS",
  "ASIANPAINT.NS",
  "AXISBANK.NS",
  "BAJAJ-AUTO.NS",
  "BAJFINANCE.NS",
  "BAJAJFINSV.NS",
  "BPCL.NS",
  "BHARTIARTL.NS",
  "BRITANNIA.NS",
  "CIPLA.NS",
  "COALINDIA.NS",
  "DIVISLAB.NS",
  "DRREDDY.NS",
  "EICHERMOT.NS",
  "GRASIM.NS",
  "HCLTECH.NS",
  "HDFCBANK.NS",
  "HDFCLIFE.NS",
  "HEROMOTOCO.NS",
  "HINDALCO.NS",
  "HINDUNILVR.NS",
  "ICICIBANK.NS",
  "INDUSINDBK.NS",
  "INFY.NS",
  "ITC.NS",
  "JSWSTEEL.NS",
  "KOTAKBANK.NS",
  "LT.NS",
  "LTM.NS", // LTIMindtree, renamed LTM
  "M&M.NS",
  "MARUTI.NS",
  "NESTLEIND.NS",
  "NTPC.NS",
  "ONGC.NS",
  "POWERGRID.NS",
  "RELIANCE.NS",
  "SBILIFE.NS",
  "SBIN.NS",
  "SUNPHARMA.NS",
  "TATACONSUM.NS",
  "TMPV.NS", // Tata Motors Passenger Vehicles (demerged)

  "TMCV.NS", // Tata Motors commercial vehicles
  "TATASTEEL.NS",
  "TCS.NS",
  "TECHM.NS",
  "TITAN.NS",
  "ULTRACEMCO.NS",
  "WIPRO.NS",
  "SHRIRAMFIN.NS",
];

// ---------------------------------------------------------------------------
// Market indices
// ---------------------------------------------------------------------------

export const MARKET_INDICES: MarketIndex[] = [
  { symbol: "^NSEI", name: "Nifty 50", type: "broad" },
  { symbol: "^BSESN", name: "Sensex", type: "broad" },
  { symbol: "^NSEBANK", name: "Bank Nifty", type: "sectoral" },
  { symbol: "NIFTY_IT.NS", name: "Nifty IT", type: "sectoral" },
  { symbol: "NIFTY_PHARMA.NS", name: "Nifty Pharma", type: "sectoral" },
];

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Returns a deduplicated flat array of every stock symbol across all sectors
 * and the Nifty 50 list.
 */
export function getAllStocks(): string[] {
  const allSectorStocks = Object.values(SECTORS).flat();
  const combined = [...allSectorStocks, ...NIFTY_50];
  return [...new Set(combined)];
}

/**
 * Returns the array of stock symbols belonging to the given sector.
 *
 * @param sector - The sector name (case-sensitive, must match a key in `SECTORS`).
 * @returns The list of symbols, or an empty array if the sector is not found.
 */
export function getStocksBySector(sector: string): string[] {
  return SECTORS[sector as SectorName] ?? [];
}
