import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { getPortfolioView, runPortfolio } from "@/lib/portfolio/engine";

export const maxDuration = 300;

/** The momentum + quality paper portfolio with live values. */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request);
  if (auth instanceof Response) return auth;
  try {
    return Response.json(await getPortfolioView());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not load the portfolio" }, { status: 502 });
  }
}

/** { action: "rebalance" } — select the basket and rebalance now (starts the portfolio if it has not started). */
export async function POST(request: NextRequest) {
  const auth = await requireRole(request);
  if (auth instanceof Response) return auth;
  const action = (await request.json().catch(() => ({})))?.action;
  if (action !== "rebalance") return Response.json({ error: "action must be rebalance" }, { status: 400 });
  try {
    return Response.json(await runPortfolio(true));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Rebalance failed" }, { status: 502 });
  }
}
