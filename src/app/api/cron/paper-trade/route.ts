import type { NextRequest } from "next/server";
import { safeEqual } from "@/lib/auth/password";
import { runPaperAgent, settleOpenTrades } from "@/lib/paper/engine";

// Vercel Cron, Mon–Fri during market hours: settle earlier paper trades, then let the agent
// enter today's intraday calls (once per day). Requires "Authorization: Bearer <CRON_SECRET>".
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const settled = await settleOpenTrades(true);
    const run = await runPaperAgent("auto");
    return Response.json({ settled, run });
  } catch (error) {
    console.error("[paper-trade cron] failed:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Paper trading run failed" }, { status: 500 });
  }
}
