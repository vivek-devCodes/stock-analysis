import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { getStockView } from "@/lib/exchange/store";

export const maxDuration = 120;

const SYMBOL_RE = /^[A-Z0-9^][A-Z0-9.\-=&^]{0,19}$/i;

/** NSE/BSE exchange data for one stock, interpreted into signals (what the agents use). */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request);
  if (auth instanceof Response) return auth;
  const symbol = request.nextUrl.searchParams.get("symbol") ?? "";
  if (!SYMBOL_RE.test(symbol)) return Response.json({ error: "Invalid symbol" }, { status: 400 });
  try {
    return Response.json(await getStockView(symbol.toUpperCase()));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Exchange data unavailable" }, { status: 502 });
  }
}
