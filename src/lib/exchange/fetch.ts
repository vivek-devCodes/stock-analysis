import "server-only";
import { inflateRawSync } from "node:zlib";
import { DATASET } from "./catalog";
import type { DatasetId } from "./types";

/**
 * Downloads NSE / BSE public report files. These are the exchanges' own published files
 * (the same ones behind "Daily Reports" on nseindia.com and the BSE bhavcopy page). The client
 * identifies itself honestly, makes a handful of requests a day and never touches the
 * cookie-gated website APIs.
 */

const UA = "ApexDesk/1.0 (end-of-day research; public report files)";
const TIMEOUT_MS = 25_000;

/** Minimal ZIP reader: returns the first file in the archive (stored or deflated). */
export function unzipFirst(buf: Buffer): Buffer {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a ZIP file");
  const cd = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt32LE(cd) !== 0x02014b50) throw new Error("Bad ZIP central directory");
  const method = buf.readUInt16LE(cd + 10);
  const size = buf.readUInt32LE(cd + 20);
  const local = buf.readUInt32LE(cd + 42);
  const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
  const data = buf.subarray(start, start + size);
  if (method === 0) return Buffer.from(data);
  if (method === 8) return inflateRawSync(data);
  throw new Error(`Unsupported ZIP compression method ${method}`);
}

async function get(url: string, method: "GET" | "HEAD" = "GET"): Promise<Response> {
  return fetch(url, { method, headers: { "User-Agent": UA, Accept: "*/*" }, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
}

/** Text of a dataset for a date, or null when the exchange has not published it (404 / holiday). */
export async function download(id: DatasetId, date: string): Promise<string> {
  const spec = DATASET[id];
  const res = await get(spec.url(date));
  if (res.status === 404) throw new Error(`not published (${spec.file(date)})`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${spec.file(date)}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const text = (spec.zip ? unzipFirst(buf) : buf).toString("utf8");
  if (/^\s*<(!doctype|html)/i.test(text)) throw new Error(`got an HTML page instead of ${spec.file(date)}`);
  return text;
}

/** Does the equity bhavcopy exist for this date? (Cheap HEAD request.) */
export async function published(date: string): Promise<boolean> {
  try {
    const res = await get(DATASET.bhav.url(date), "HEAD");
    if (res.status === 405) return (await get(DATASET.bhav.url(date))).ok;
    return res.ok;
  } catch {
    return false;
  }
}

const IST_MS = 5.5 * 3600_000;
export const istToday = () => new Date(Date.now() + IST_MS).toISOString().slice(0, 10);

/** Weekdays going back from `from` (inclusive). */
export function previousWeekdays(from: string, count: number): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  while (out.length < count) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out;
}

/** Most recent trading day whose files NSE has published (holidays have no bhavcopy). */
export async function latestPublishedDate(): Promise<string | null> {
  for (const d of previousWeekdays(istToday(), 8)) if (await published(d)) return d;
  return null;
}
