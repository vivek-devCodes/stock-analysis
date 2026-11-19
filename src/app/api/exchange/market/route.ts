import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { interpretMarket } from "@/lib/exchange/interpret";
import { getLiveMovers } from "@/lib/exchange/live";
import { getMarketDay, refreshExchangeData } from "@/lib/exchange/store";

export const maxDuration = 300;

/** The latest NSE market day (breadth, FII positioning, lists, deals, surveillance) + live movers. */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request);
  if (auth instanceof Response) return auth;
  try {
    const [market, live] = await Promise.all([getMarketDay(), getLiveMovers()]);
    return Response.json({ market, signals: interpretMarket(market), live });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Exchange data unavailable" }, { status: 502 });
  }
}

/** { action: "refresh" } — download the latest published NSE/BSE files now. */
export async function POST(request: NextRequest) {
  const auth = await requireRole(request);
  if (auth instanceof Response) return auth;
  const body = await request.json().catch(() => ({}));
  if (body?.action !== "refresh") return Response.json({ error: "action must be refresh" }, { status: 400 });
  try {
    return Response.json(await refreshExchangeData(body?.force === true));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Refresh failed" }, { status: 502 });
  }
}
