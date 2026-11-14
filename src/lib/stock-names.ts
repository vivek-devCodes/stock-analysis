// Headline aliases for the NSE universe, used to tag news to stocks.
// Matching is whole-word and case-insensitive, so keep aliases specific.

export const STOCK_ALIASES: Record<string, string[]> = {
  "HDFCBANK.NS": ["HDFC Bank"],
  "ICICIBANK.NS": ["ICICI Bank"],
  "SBIN.NS": ["SBI", "State Bank of India"],
  "KOTAKBANK.NS": ["Kotak Mahindra Bank", "Kotak Bank"],
  "AXISBANK.NS": ["Axis Bank"],
  "BANKBARODA.NS": ["Bank of Baroda", "BoB"],
  "PNB.NS": ["PNB", "Punjab National Bank"],
  "INDUSINDBK.NS": ["IndusInd Bank", "IndusInd"],
  "TCS.NS": ["TCS", "Tata Consultancy"],
  "INFY.NS": ["Infosys"],
  "WIPRO.NS": ["Wipro"],
  "HCLTECH.NS": ["HCL Tech", "HCLTech", "HCL Technologies"],
  "TECHM.NS": ["Tech Mahindra"],
  "LTM.NS": ["LTIMindtree", "LTM"],
  "PERSISTENT.NS": ["Persistent Systems"],
  "COFORGE.NS": ["Coforge"],
  "SUNPHARMA.NS": ["Sun Pharma", "Sun Pharmaceutical"],
  "DRREDDY.NS": ["Dr Reddy's", "Dr. Reddy's", "Dr Reddys"],
  "CIPLA.NS": ["Cipla"],
  "DIVISLAB.NS": ["Divi's Lab", "Divis Lab", "Divi's Laboratories"],
  "APOLLOHOSP.NS": ["Apollo Hospitals"],
  "BIOCON.NS": ["Biocon"],
  "MARUTI.NS": ["Maruti", "Maruti Suzuki"],
  "TMPV.NS": ["Tata Motors", "Tata Motors Passenger", "TMPV"],
  "TMCV.NS": ["Tata Motors Commercial", "TMCV"],
  "M&M.NS": ["Mahindra & Mahindra", "M&M"],
  "BAJAJ-AUTO.NS": ["Bajaj Auto"],
  "HEROMOTOCO.NS": ["Hero MotoCorp", "Hero Moto"],
  "EICHERMOT.NS": ["Eicher Motors", "Royal Enfield"],
  "HINDUNILVR.NS": ["Hindustan Unilever", "HUL"],
  "ITC.NS": ["ITC"],
  "NESTLEIND.NS": ["Nestle India", "Nestle"],
  "BRITANNIA.NS": ["Britannia"],
  "DABUR.NS": ["Dabur"],
  "COLPAL.NS": ["Colgate-Palmolive", "Colgate"],
  "GODREJCP.NS": ["Godrej Consumer"],
  "RELIANCE.NS": ["Reliance Industries", "RIL"],
  "ONGC.NS": ["ONGC"],
  "NTPC.NS": ["NTPC"],
  "POWERGRID.NS": ["Power Grid"],
  "ADANIGREEN.NS": ["Adani Green"],
  "TATAPOWER.NS": ["Tata Power"],
  "TATASTEEL.NS": ["Tata Steel"],
  "HINDALCO.NS": ["Hindalco"],
  "JSWSTEEL.NS": ["JSW Steel"],
  "COALINDIA.NS": ["Coal India"],
  "VEDL.NS": ["Vedanta"],
  "DLF.NS": ["DLF"],
  "GODREJPROP.NS": ["Godrej Properties"],
  "OBEROIRLTY.NS": ["Oberoi Realty"],
  "PRESTIGE.NS": ["Prestige Estates"],
  "LTTS.NS": ["L&T Technology Services", "LTTS"],
  "LT.NS": ["Larsen & Toubro", "Larsen", "L&T"],
  "ADANIENT.NS": ["Adani Enterprises"],
  "ADANIPORTS.NS": ["Adani Ports"],
  "BAJFINANCE.NS": ["Bajaj Finance"],
  "BAJAJFINSV.NS": ["Bajaj Finserv"],
  "HDFCLIFE.NS": ["HDFC Life"],
  "SBILIFE.NS": ["SBI Life"],
  "ICICIPRULI.NS": ["ICICI Prudential Life", "ICICI Pru Life"],
  "ASIANPAINT.NS": ["Asian Paints"],
  "BPCL.NS": ["BPCL", "Bharat Petroleum"],
  "BHARTIARTL.NS": ["Bharti Airtel", "Airtel"],
  "GRASIM.NS": ["Grasim"],
  "TATACONSUM.NS": ["Tata Consumer"],
  "TITAN.NS": ["Titan"],
  "ULTRACEMCO.NS": ["UltraTech Cement", "UltraTech"],
  "SHRIRAMFIN.NS": ["Shriram Finance"],
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Longest aliases first so "Tata Motors Commercial" wins over "Tata Motors".
const MATCHERS = Object.entries(STOCK_ALIASES)
  .flatMap(([symbol, aliases]) => aliases.map((alias) => ({ symbol, alias })))
  .sort((a, b) => b.alias.length - a.alias.length)
  .map(({ symbol, alias }) => ({
    symbol,
    re: new RegExp(`(^|[^A-Za-z0-9])${escape(alias)}(?=$|[^A-Za-z0-9])`, /[a-z]/.test(alias) ? "i" : ""),
  }));

/** Symbols mentioned in a headline. All-caps aliases (ITC, DLF…) match case-sensitively to avoid false hits. */
export function tagStocks(text: string): string[] {
  const found = new Set<string>();
  let rest = text;
  for (const { symbol, re } of MATCHERS) {
    if (re.test(rest)) {
      found.add(symbol);
      rest = rest.replace(re, "$1 "); // consume so a shorter alias of another stock doesn't re-match
    }
  }
  return [...found];
}
