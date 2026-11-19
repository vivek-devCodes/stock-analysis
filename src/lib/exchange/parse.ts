// Pure parsers for the NSE / BSE public report files. No I/O; covered by src/scripts/test-exchange.ts.

import type { DealRow, ParticipantRow } from "./types";

/* ------------------------------------------- CSV ------------------------------------------- */

/** RFC-4180-ish CSV: quoted fields, doubled quotes, CRLF. Cells are trimmed. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell.trim());
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}

/** Rows as objects keyed by the (trimmed) header found at `headerRow`. */
export function csvObjects(text: string, headerRow = 0): Array<Record<string, string>> {
  const rows = parseCsv(text);
  const header = rows[headerRow]?.map((h) => h.trim()) ?? [];
  return rows.slice(headerRow + 1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

/** "1,234.5" / "-" / "" → number | null. */
export function n(v: string | undefined): number | null {
  if (v == null) return null;
  const s = v.replace(/,/g, "").trim();
  if (!s || s === "-" || /^nil$/i.test(s)) return null;
  const x = Number(s);
  return Number.isFinite(x) ? x : null;
}

const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };

/** "18-Nov-2026" / "18-NOV-2026" / "18-11-2026" / "2026-11-18" / "18-Nov-26" → "2026-11-18". */
export function isoDate(v: string | undefined): string | null {
  if (!v) return null;
  const s = v.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})/);
  if (m && MONTHS[m[2].toLowerCase()]) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

/* --------------------------------- Equity bhavcopy (delivery) --------------------------------- */

export type BhavRow = {
  symbol: string;
  series: string;
  date: string | null;
  prevClose: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnoverLacs: number;
  trades: number;
  deliveryQty: number | null;
  deliveryPct: number | null;
};

/** Series that trade as ordinary equity (EQ), trade-to-trade (BE/BZ) and SME (SM/ST). */
const EQUITY_SERIES = new Set(["EQ", "BE", "BZ", "SM", "ST"]);

export function parseBhav(text: string): BhavRow[] {
  return csvObjects(text)
    .filter((r) => EQUITY_SERIES.has(r.SERIES))
    .map((r) => ({
      symbol: r.SYMBOL,
      series: r.SERIES,
      date: isoDate(r.DATE1),
      prevClose: n(r.PREV_CLOSE) ?? 0,
      open: n(r.OPEN_PRICE) ?? 0,
      high: n(r.HIGH_PRICE) ?? 0,
      low: n(r.LOW_PRICE) ?? 0,
      close: n(r.CLOSE_PRICE) ?? 0,
      volume: n(r.TTL_TRD_QNTY) ?? 0,
      turnoverLacs: n(r.TURNOVER_LACS) ?? 0,
      trades: n(r.NO_OF_TRADES) ?? 0,
      deliveryQty: n(r.DELIV_QTY),
      deliveryPct: n(r.DELIV_PER),
    }))
    .filter((r) => r.symbol && r.close > 0);
}

/* ------------------------------ Price bands & surveillance (GSM) ------------------------------ */

export function parseSecList(text: string): Map<string, { series: string; band: number | null; gsm: string | null }> {
  const out = new Map<string, { series: string; band: number | null; gsm: string | null }>();
  for (const r of csvObjects(text)) {
    if (!r.Symbol) continue;
    const remark = (r.Remarks ?? "").replace(/\s+/g, " ").trim();
    const gsm = /GSM/i.test(remark) ? remark.replace(/^GSM STAGE\s*-\s*/i, "Stage ") : null;
    out.set(r.Symbol, { series: r.Series, band: n(r.Band), gsm });
  }
  return out;
}

/* ------------------------------------------ F&O ban ------------------------------------------ */

export function parseBan(text: string): string[] {
  return parseCsv(text)
    .slice(1)
    .map((r) => (r.length >= 2 ? r[1] : r[0]))
    .filter((s): s is string => !!s && /^[A-Z0-9&-]+$/.test(s));
}

/* ---------------------------------------- Large deals ---------------------------------------- */

export function parseDeals(text: string, kind: "bulk" | "block"): Array<DealRow & { symbol: string; name: string }> {
  return csvObjects(text)
    .filter((r) => r.Symbol && r.Date && !/NO RECORDS/i.test(r.Date))
    .map((r) => ({
      kind,
      symbol: r.Symbol,
      name: r["Security Name"] ?? r.Symbol,
      date: isoDate(r.Date) ?? r.Date,
      client: r["Client Name"] ?? "",
      side: (/^S/i.test(r["Buy/Sell"] ?? "") ? "SELL" : "BUY") as "BUY" | "SELL",
      qty: n(r["Quantity Traded"]) ?? 0,
      price: n(r["Trade Price / Wght. Avg. Price"]) ?? 0,
    }));
}

/* ------------------------------------------ Indices ------------------------------------------ */

export function parseIndices(text: string) {
  return csvObjects(text)
    .filter((r) => r["Index Name"])
    .map((r) => ({
      name: r["Index Name"],
      close: n(r["Closing Index Value"]) ?? 0,
      changePct: n(r["Change(%)"]) ?? 0,
      pe: n(r["P/E"]),
      pb: n(r["P/B"]),
      divYield: n(r["Div Yield"]),
    }))
    .filter((r) => r.close > 0);
}

/* ---------------------------------------- 52-week high/low ---------------------------------------- */

export function parse52Week(text: string): Map<string, { high: number | null; highDate: string | null; low: number | null; lowDate: string | null }> {
  const rows = parseCsv(text);
  const h = rows.findIndex((r) => r[0] === "SYMBOL");
  const out = new Map<string, { high: number | null; highDate: string | null; low: number | null; lowDate: string | null }>();
  if (h < 0) return out;
  for (const r of rows.slice(h + 1)) {
    if (!r[0] || (r[1] && !EQUITY_SERIES.has(r[1]))) continue;
    out.set(r[0], { high: n(r[2]), highDate: isoDate(r[3]), low: n(r[4]), lowDate: isoDate(r[5]) });
  }
  return out;
}

/* ------------------------------------ Securities / F&O lists ------------------------------------ */

export function parseEquityList(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of csvObjects(text)) if (r.SYMBOL) out.set(r.SYMBOL, r["NAME OF COMPANY"] ?? r.SYMBOL);
  return out;
}

/** fo_mktlots.csv → symbol → lot size of the nearest month. */
export function parseLots(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of parseCsv(text)) {
    const sym = r[1]?.trim();
    if (!sym || /^symbol$/i.test(sym)) continue;
    const lot = r.slice(2).map((c) => n(c)).find((x) => x != null && x > 0);
    if (lot) out.set(sym, lot);
  }
  return out;
}

/** FOVOLT → symbol → applicable annualised volatility (fraction). */
export function parseVolatility(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of parseCsv(text).slice(1)) {
    const sym = r[1]?.trim();
    const v = n(r.at(-1));
    if (sym && v != null && v > 0 && v < 5) out.set(sym, v);
  }
  return out;
}

/** Participant-wise OI (contracts): Client / DII / FII / Pro / TOTAL. */
export function parseParticipants(text: string): ParticipantRow[] {
  const rows = parseCsv(text);
  const h = rows.findIndex((r) => /client type/i.test(r[0] ?? ""));
  if (h < 0) return [];
  return rows
    .slice(h + 1)
    .filter((r) => r[0] && !/total/i.test(r[0]))
    .map((r) => {
      const futIndexLong = n(r[1]) ?? 0;
      const futIndexShort = n(r[2]) ?? 0;
      return {
        client: r[0],
        futIndexLong,
        futIndexShort,
        futStockLong: n(r[3]) ?? 0,
        futStockShort: n(r[4]) ?? 0,
        longPct: futIndexLong + futIndexShort > 0 ? futIndexLong / (futIndexLong + futIndexShort) : null,
      };
    });
}

/* ------------------------------------------ UDiFF bhavcopies ------------------------------------------ */

export type FoRow = {
  type: string; // IDF / STF (futures), IDO / STO (options)
  symbol: string;
  expiry: string;
  strike: number | null;
  optType: "CE" | "PE" | null;
  close: number;
  prevClose: number;
  underlying: number | null;
  oi: number;
  chgOi: number;
  contracts: number;
  turnover: number;
  lot: number | null;
};

export function parseFoBhav(text: string): { date: string | null; rows: FoRow[] } {
  const objs = csvObjects(text);
  const rows: FoRow[] = [];
  let date: string | null = null;
  for (const r of objs) {
    if (!r.TckrSymb || !r.XpryDt) continue;
    date ??= isoDate(r.TradDt);
    const opt = r.OptnTp === "CE" || r.OptnTp === "PE" ? r.OptnTp : null;
    rows.push({
      type: r.FinInstrmTp,
      symbol: r.TckrSymb,
      expiry: isoDate(r.XpryDt) ?? r.XpryDt,
      strike: n(r.StrkPric),
      optType: opt,
      close: n(r.ClsPric) ?? 0,
      prevClose: n(r.PrvsClsgPric) ?? 0,
      underlying: n(r.UndrlygPric),
      oi: n(r.OpnIntrst) ?? 0,
      chgOi: n(r.ChngInOpnIntrst) ?? 0,
      contracts: n(r.TtlTradgVol) ?? 0,
      turnover: n(r.TtlTrfVal) ?? 0,
      lot: n(r.NewBrdLotQty),
    });
  }
  return { date, rows };
}

/** BSE UDiFF equity bhavcopy → symbol → close / volume / turnover. */
export function parseBseBhav(text: string): Map<string, { close: number; volume: number; turnoverCr: number }> {
  const out = new Map<string, { close: number; volume: number; turnoverCr: number }>();
  for (const r of csvObjects(text)) {
    if (r.FinInstrmTp !== "STK" || !r.TckrSymb) continue;
    const close = n(r.ClsPric);
    if (!close) continue;
    out.set(r.TckrSymb, { close, volume: n(r.TtlTradgVol) ?? 0, turnoverCr: (n(r.TtlTrfVal) ?? 0) / 1e7 });
  }
  return out;
}
