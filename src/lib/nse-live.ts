import "server-only";
import type { LiveQuote } from "./types";

/**
 * Minimal client for NSE's official live-market server (https://www.nseindia.com/nse-mcp).
 * It speaks MCP — plain JSON-RPC over HTTP POST — so we call it directly: no SDK, no AI.
 * Data refreshes every ~1 minute during market hours; outside them NSE returns an error
 * and callers fall back to Yahoo. NSE terms: informational, non-commercial use.
 */

const ENDPOINT = "https://mcp.nseindia.in/cmmkt/mcp";
const PROTOCOL = "2025-06-18";
const TIMEOUT_MS = 6000;
const CACHE_MS = 30_000;

let sessionId: string | null = null;
let sessionInit: Promise<string> | null = null;
let rpcId = 0;

async function post(body: unknown, sid: string | null): Promise<Response> {
  return fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": PROTOCOL,
      ...(sid ? { "Mcp-Session-Id": sid } : {}),
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/** Responses come either as JSON or as a Server-Sent-Events stream with "data:" lines. */
async function readRpc(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  const payload = (res.headers.get("content-type") ?? "").includes("text/event-stream")
    ? text
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("")
    : text;
  return JSON.parse(payload) as Record<string, unknown>;
}

async function initSession(): Promise<string> {
  const res = await post(
    {
      jsonrpc: "2.0",
      id: ++rpcId,
      method: "initialize",
      params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "apex-desk", version: "1.0" } },
    },
    null,
  );
  if (!res.ok) throw new Error(`NSE initialize HTTP ${res.status}`);
  await res.text();
  const sid = res.headers.get("mcp-session-id");
  if (!sid) throw new Error("NSE did not return a session id");
  await post({ jsonrpc: "2.0", method: "notifications/initialized" }, sid).then((r) => r.text());
  return sid;
}

async function getSessionId(force = false): Promise<string> {
  if (force) sessionId = null;
  if (sessionId) return sessionId;
  sessionInit ??= initSession().finally(() => (sessionInit = null));
  sessionId = await sessionInit;
  return sessionId;
}

/** Call one tool; returns the JSON the tool put in its text content. Throws on tool errors. */
export async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const sid = await getSessionId(attempt > 0);
    const res = await post({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }, sid);
    if (res.status === 404 || res.status === 400) continue; // session expired → re-initialise once
    if (!res.ok) throw new Error(`NSE ${name} HTTP ${res.status}`);
    const msg = await readRpc(res);
    const result = msg.result as { content?: Array<{ type: string; text?: string }>; isError?: boolean } | undefined;
    const text = result?.content?.find((c) => c.type === "text")?.text;
    if (!text) throw new Error(`NSE ${name}: empty response`);
    const data = JSON.parse(text) as Record<string, unknown>;
    if (result?.isError || (data && typeof data === "object" && "error" in data && !Array.isArray(data))) {
      throw new Error(`NSE ${name}: ${String((data as { error?: unknown }).error ?? "error")}`);
    }
    return data;
  }
  throw new Error(`NSE ${name}: session could not be established`);
}

/* ------------------------------------------------------------------ */
/*  Tolerant parsing — field names differ between NSE tools.           */
/* ------------------------------------------------------------------ */

const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");

function pick(obj: Record<string, unknown>, aliases: string[]): unknown {
  const map = new Map(Object.entries(obj).map(([k, v]) => [norm(k), v]));
  for (const a of aliases) if (map.has(a)) return map.get(a);
  return undefined;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** NSE timestamps look like "14-Nov-2026 15:29:58" (IST) or ISO strings. Returns unix seconds. */
function parseTime(v: unknown): number | null {
  if (typeof v === "number") return v > 1e12 ? Math.floor(v / 1000) : v;
  if (typeof v !== "string") return null;
  const m = v.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m && MONTHS[m[2].toLowerCase()] != null) {
    const utc = Date.UTC(+m[3], MONTHS[m[2].toLowerCase()], +m[1], +(m[4] ?? 15), +(m[5] ?? 30), +(m[6] ?? 0));
    return Math.floor(utc / 1000) - 19800; // IST → UTC
  }
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

function findRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === "object") {
    for (const v of Object.values(data)) {
      if (Array.isArray(v) && v.length && typeof v[0] === "object") return v as Record<string, unknown>[];
    }
    for (const v of Object.values(data)) {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const nested = findRows(v);
        if (nested.length) return nested;
      }
    }
  }
  return [];
}

function toLive(row: Record<string, unknown>, symbol: string, name: string, fallbackTime: number | null): LiveQuote | null {
  const price = num(pick(row, ["ltp", "lastprice", "last", "lastvalue", "lasttradedprice", "value", "close"]));
  if (price == null || price <= 0) return null;
  const prev = num(pick(row, ["previousclose", "prevclose", "preclose", "precloseprice", "previousclosevalue"]));
  const change = num(pick(row, ["change", "netchange", "chg", "variation"])) ?? (prev != null ? price - prev : 0);
  const pct =
    num(pick(row, ["pchange", "percentchange", "perchange", "pctchange", "changepercent"])) ??
    (prev ? ((price - prev) / prev) * 100 : 0);
  const time = parseTime(pick(row, ["latesttimestamp", "timestamp", "lastupdatetime", "time", "updatedat", "lastupdated"])) ?? fallbackTime;
  return {
    symbol,
    name,
    price,
    change,
    changePercent: pct,
    previousClose: prev,
    open: num(pick(row, ["open", "dayopen"])),
    dayHigh: num(pick(row, ["high", "dayhigh"])),
    dayLow: num(pick(row, ["low", "daylow"])),
    volume: num(pick(row, ["volume", "totaltradedvolume", "tradedvolume"])),
    time: time ?? Math.floor(Date.now() / 1000),
    marketState: "REGULAR",
    delayMinutes: 1,
    source: "NSE (1-min)",
  };
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/** Yahoo symbol → NSE live index name. Sensex is a BSE index, so it stays on Yahoo. */
export const NSE_INDEX_NAMES: Record<string, string> = {
  "^NSEI": "NIFTY 50",
  "^NSEBANK": "NIFTY BANK",
  "^CNXIT": "NIFTY IT",
  "^INDIAVIX": "INDIA VIX",
  "^NSEMDCP50": "NIFTY MIDCAP 50",
};

export function isNseSymbol(symbol: string) {
  return symbol.endsWith(".NS") || symbol in NSE_INDEX_NAMES;
}

const cache = new Map<string, { at: number; promise: Promise<LiveQuote | null> }>();

function cached(key: string, load: () => Promise<LiveQuote | null>) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
  const promise = load().catch(() => null);
  cache.set(key, { at: Date.now(), promise });
  return promise;
}

let indicesPromise: { at: number; promise: Promise<Record<string, unknown>[]> } | null = null;

function liveIndices() {
  if (!indicesPromise || Date.now() - indicesPromise.at > CACHE_MS) {
    indicesPromise = {
      at: Date.now(),
      promise: callTool("cm_get_live_indices", { group: "", nameFilter: "" }).then(findRows).catch(() => []),
    };
  }
  return indicesPromise.promise;
}

/** Live NSE quote for a Yahoo-style symbol, or null when NSE has no data (e.g. market closed). */
export function nseLiveQuote(symbol: string): Promise<LiveQuote | null> {
  const indexName = NSE_INDEX_NAMES[symbol];
  if (indexName) {
    return cached(symbol, async () => {
      const rows = await liveIndices();
      const row = rows.find((r) => String(pick(r, ["index", "indexname", "name", "indexsymbol"]) ?? "").toUpperCase() === indexName);
      return row ? toLive(row, symbol, indexName, null) : null;
    });
  }
  if (!symbol.endsWith(".NS")) return Promise.resolve(null);
  const nseSymbol = symbol.slice(0, -3);
  return cached(symbol, async () => {
    const data = await callTool("cm_get_stock_quote", { symbol: nseSymbol });
    const row = findRows(data)[0] ?? (data as Record<string, unknown>);
    return toLive(row, symbol, nseSymbol, null);
  });
}
