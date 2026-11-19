// Exchange data (NSE + BSE public end-of-day files and NSE's live market server).
// Shared contract for the server pipeline, the agents and the pages. No server-only imports.

/** Every dataset the pipeline reads. Each maps to one NSE/BSE page (see catalog.ts). */
export type DatasetId =
  | "bhav" // Equity Daily Report: security-wise bhavcopy with delivery %
  | "fo" // Derivatives Daily Report: F&O bhavcopy (UDiFF) — option chain, OI, futures
  | "seclist" // Price Bands & Surveillance Actions: price band + GSM stage per security
  | "ban" // Securities in F&O ban
  | "bulk" // Large Deals: bulk deals
  | "block" // Large Deals: block deals
  | "indices" // Indices: closing values, P/E, P/B, dividend yield
  | "wk52" // 52 Week High/Low (corporate-action adjusted)
  | "equityList" // Securities Available For Trading
  | "lots" // F&O lot sizes (which stocks are in F&O)
  | "volt" // F&O underlying volatility (NSE Clearing)
  | "participants" // Participant-wise open interest (FII / DII / Pro / Client)
  | "bse"; // BSE equity bhavcopy

export type SourceStatus = {
  id: DatasetId;
  page: string;
  file: string;
  url: string;
  ok: boolean;
  rows: number;
  error?: string;
};

export type DealRow = { date: string; client: string; side: "BUY" | "SELL"; qty: number; price: number; kind: "bulk" | "block" };

export type Greeks = {
  /** Option close price used. */
  price: number;
  /** Implied volatility, annualised (0.22 = 22%). */
  iv: number;
  delta: number;
  gamma: number;
  /** Per calendar day, in ₹ per share. */
  theta: number;
  /** Per 1 volatility point, in ₹ per share. */
  vega: number;
};

export type Buildup = "long build-up" | "short build-up" | "short covering" | "long unwinding";

export type FnoSummary = {
  /** Nearest options expiry used for the chain (YYYY-MM-DD). */
  expiry: string;
  daysToExpiry: number;
  underlying: number | null;
  futPrice: number | null;
  futChangePct: number | null;
  futOi: number | null;
  futOiChangePct: number | null;
  buildup: Buildup | null;
  /** Futures basis = futures − spot, % of spot. */
  basisPct: number | null;
  callOi: number;
  putOi: number;
  callOiChange: number;
  putOiChange: number;
  /** Put–call ratio of open interest, nearest expiry. */
  pcr: number | null;
  maxPain: number | null;
  /** Strike with the highest call OI (option writers' ceiling). */
  resistance: number | null;
  /** Strike with the highest put OI (option writers' floor). */
  support: number | null;
  atmStrike: number | null;
  atmIv: number | null;
  atmCall: Greeks | null;
  atmPut: Greeks | null;
  /** All contracts traded in this underlying today (futures + options). */
  contracts: number;
  turnoverCr: number;
  lotSize: number | null;
  /** Top strikes by OI for display: [strike, callOi, putOi]. */
  chain: Array<[number, number, number]>;
};

export type StockDay = {
  symbol: string;
  series: string;
  open: number;
  high: number;
  low: number;
  close: number;
  prevClose: number;
  changePct: number;
  volume: number;
  turnoverLacs: number;
  trades: number;
  deliveryQty: number | null;
  deliveryPct: number | null;
  /** Averages over the previous stored sessions (null without history). */
  deliveryAvg: number | null;
  volumeAvg: number | null;
  volRatio: number | null;
  historyDays: number;
  /** Price band in % (2, 5, 10, 20); null = no band (F&O stocks). */
  band: number | null;
  gsm: string | null;
  /** Hit its price band today (upper/lower circuit). */
  bandHit: "upper" | "lower" | null;
  fnoBan: boolean;
  inFno: boolean;
  lotSize: number | null;
  wk52High: number | null;
  wk52HighDate: string | null;
  wk52Low: number | null;
  wk52LowDate: string | null;
  /** Annualised volatility from NSE Clearing (F&O stocks). */
  annualVol: number | null;
  deals: DealRow[];
  fno: FnoSummary | null;
  bse: { close: number; volume: number; turnoverCr: number } | null;
};

export type ListRow = { symbol: string; close: number; changePct: number; value: number; note?: string };

export type ParticipantRow = { client: string; futIndexLong: number; futIndexShort: number; futStockLong: number; futStockShort: number; longPct: number | null };

export type MarketDay = {
  /** Trading date of the files, YYYY-MM-DD. */
  tradeDate: string;
  builtAt: string;
  sources: SourceStatus[];
  breadth: { advances: number; declines: number; unchanged: number; ratio: number | null };
  indices: Array<{ name: string; close: number; changePct: number; pe: number | null; pb: number | null; divYield: number | null }>;
  participants: ParticipantRow[];
  fnoBan: string[];
  gsm: Array<{ symbol: string; stage: string }>;
  gainers: ListRow[];
  losers: ListRow[];
  mostActive: ListRow[];
  volumeGainers: ListRow[];
  highDelivery: ListRow[];
  wk52Highs: ListRow[];
  wk52Lows: ListRow[];
  bandHitters: ListRow[];
  mostActiveUnderlying: ListRow[];
  oiSpurts: ListRow[];
  deals: Array<DealRow & { symbol: string; name: string }>;
  /** Index options/futures analytics (NIFTY, BANKNIFTY, FINNIFTY…). */
  indexFno: Record<string, FnoSummary>;
  counts: { equities: number; fnoUnderlyings: number; bse: number };
};

/** One interpreted data point shown on the analyzer and used by the agents. */
export type ExchangeSignal = {
  id: string;
  label: string;
  value: string;
  /** bullish / bearish = direction evidence; risk = a reason to avoid or size down; info = context. */
  effect: "bullish" | "bearish" | "risk" | "info";
  /** For risk signals: block the trade for these horizons. */
  blocks?: Array<"intraday" | "swing" | "long-term">;
  detail: string;
  source: DatasetId | "history" | "events" | "live";
};

export type CorporateEvents = {
  earningsDate: string | null;
  earningsDateEnd: string | null;
  exDividendDate: string | null;
  dividendDate: string | null;
};

/** What the analyzer and the agents get for one stock. */
export type StockExchangeView = {
  symbol: string;
  tradeDate: string | null;
  stock: StockDay | null;
  events: CorporateEvents | null;
  signals: ExchangeSignal[];
  sources: SourceStatus[];
  history: Array<{ date: string; close: number; deliveryPct: number | null; volume: number }>;
  note: string | null;
};
