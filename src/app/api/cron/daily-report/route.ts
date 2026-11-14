import type { NextRequest } from "next/server";
import { safeEqual } from "@/lib/auth/password";
import { runDailyAnalysis } from "@/scripts/daily-analysis";

// Called by Vercel Cron (see vercel.json). Vercel sends "Authorization: Bearer <CRON_SECRET>".
// No user session here, so the watchlist comes from the WATCHLIST_SYMBOLS env var.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(header, `Bearer ${secret}`)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const report = await runDailyAnalysis();
    return Response.json({ success: true, date: report.date, watchlist: report.watchlist?.length ?? 0 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pipeline execution failed";
    console.error("[Cron DailyReport] Error:", error);
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
