// Which NSE / BSE page each dataset comes from, and the public file behind it.
// These are the exchanges' own published report files (Market Data → Daily Reports and the
// archives), downloaded directly — no scraping of web pages, no cookies, no API key.

import type { DatasetId } from "./types";

export const NSE_ARCHIVE = "https://nsearchives.nseindia.com";
export const BSE_DOWNLOAD = "https://www.bseindia.com/download";

/** YYYY-MM-DD → parts. */
function parts(date: string) {
  const [y, m, d] = date.split("-");
  return { y, m, d };
}

const ddmmyyyy = (dt: string) => {
  const { y, m, d } = parts(dt);
  return `${d}${m}${y}`;
};
const bhavFile = (dt: string) => `sec_bhavdata_full_${ddmmyyyy(dt)}.csv`;
const indFile = (dt: string) => `ind_close_all_${ddmmyyyy(dt)}.csv`;
const wk52File = (dt: string) => `CM_52_wk_High_low_${ddmmyyyy(dt)}.csv`;
const voltFile = (dt: string) => `FOVOLT_${ddmmyyyy(dt)}.csv`;
const poiFile = (dt: string) => `fao_participant_oi_${ddmmyyyy(dt)}.csv`;

export type DatasetSpec = {
  id: DatasetId;
  /** The NSE/BSE page a person would open to see the same data. */
  page: string;
  /** Daily file (dated) or a standing file (latest). */
  dated: boolean;
  zip?: boolean;
  url: (date: string) => string;
  file: (date: string) => string;
};

export const DATASETS: DatasetSpec[] = [
  {
    id: "bhav",
    page: "NSE › Market Data › Equity › Daily Reports (security-wise delivery)",
    dated: true,
    file: bhavFile,
    url: (dt) => `${NSE_ARCHIVE}/products/content/${bhavFile(dt)}`,
  },
  {
    id: "fo",
    page: "NSE › Market Data › Derivatives › Option Chain / Change in OI / Most Active Contracts (end of day)",
    dated: true,
    zip: true,
    file: (dt) => `BhavCopy_NSE_FO_0_0_0_${dt.replace(/-/g, "")}_F_0000.csv.zip`,
    url: (dt) => `${NSE_ARCHIVE}/content/fo/BhavCopy_NSE_FO_0_0_0_${dt.replace(/-/g, "")}_F_0000.csv.zip`,
  },
  {
    id: "seclist",
    page: "NSE › Market Data › Equity › Price Bands & Surveillance Actions",
    dated: false,
    file: () => "sec_list.csv",
    url: () => `${NSE_ARCHIVE}/content/equities/sec_list.csv`,
  },
  {
    id: "ban",
    page: "NSE › Market Data › Derivatives › Securities in Ban Period",
    dated: false,
    file: () => "fo_secban.csv",
    url: () => `${NSE_ARCHIVE}/content/fo/fo_secban.csv`,
  },
  {
    id: "bulk",
    page: "NSE › Market Data › Equity › Large Deals (bulk)",
    dated: false,
    file: () => "bulk.csv",
    url: () => `${NSE_ARCHIVE}/content/equities/bulk.csv`,
  },
  {
    id: "block",
    page: "NSE › Market Data › Equity › Large Deals (block)",
    dated: false,
    file: () => "block.csv",
    url: () => `${NSE_ARCHIVE}/content/equities/block.csv`,
  },
  {
    id: "indices",
    page: "NSE › Market Data › Equity › Indices",
    dated: true,
    file: indFile,
    url: (dt) => `${NSE_ARCHIVE}/content/indices/${indFile(dt)}`,
  },
  {
    id: "wk52",
    page: "NSE › Market Data › Equity › 52 Week High/Low",
    dated: true,
    file: wk52File,
    url: (dt) => `${NSE_ARCHIVE}/content/${wk52File(dt)}`,
  },
  {
    id: "equityList",
    page: "NSE › Market Data › Equity › Securities Available For Trading",
    dated: false,
    file: () => "EQUITY_L.csv",
    url: () => `${NSE_ARCHIVE}/content/equities/EQUITY_L.csv`,
  },
  {
    id: "lots",
    page: "NSE › Market Data › Derivatives › Contracts Available For Trading (lot sizes)",
    dated: false,
    file: () => "fo_mktlots.csv",
    url: () => `${NSE_ARCHIVE}/content/fo/fo_mktlots.csv`,
  },
  {
    id: "volt",
    page: "NSE Clearing › Daily Volatility (F&O underlyings)",
    dated: true,
    file: voltFile,
    url: (dt) => `${NSE_ARCHIVE}/archives/nsccl/volt/${voltFile(dt)}`,
  },
  {
    id: "participants",
    page: "NSE › Market Data › Derivatives › Participant-wise Open Interest (FII / DII / Pro / Client)",
    dated: true,
    file: poiFile,
    url: (dt) => `${NSE_ARCHIVE}/content/nsccl/${poiFile(dt)}`,
  },
  {
    id: "bse",
    page: "BSE › Market Data › Equity Bhavcopy",
    dated: true,
    file: (dt) => `BhavCopy_BSE_CM_0_0_0_${dt.replace(/-/g, "")}_F_0000.CSV`,
    url: (dt) => `${BSE_DOWNLOAD}/BhavCopy/Equity/BhavCopy_BSE_CM_0_0_0_${dt.replace(/-/g, "")}_F_0000.CSV`,
  },
];

export const DATASET = Object.fromEntries(DATASETS.map((d) => [d.id, d])) as Record<DatasetId, DatasetSpec>;

/** Short page name for chips ("Daily Reports", "Option Chain"…). */
export const SHORT_PAGE: Record<DatasetId | "history" | "events" | "live", string> = {
  bhav: "NSE Daily Reports (delivery)",
  fo: "NSE F&O bhavcopy (option chain / OI)",
  seclist: "NSE Price Bands & Surveillance",
  ban: "NSE F&O ban list",
  bulk: "NSE Large Deals (bulk)",
  block: "NSE Large Deals (block)",
  indices: "NSE Indices",
  wk52: "NSE 52 Week High/Low",
  equityList: "NSE Securities Available For Trading",
  lots: "NSE F&O lot sizes",
  volt: "NSE Clearing volatility",
  participants: "NSE Participant-wise OI",
  bse: "BSE bhavcopy",
  history: "Stored NSE history (previous sessions)",
  events: "Results & dividend calendar (Yahoo Finance)",
  live: "NSE live market server",
};
