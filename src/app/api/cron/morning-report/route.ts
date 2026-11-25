import type { NextRequest } from "next/server";
import { safeEqual } from "@/lib/auth/password";
import { sendMorningReport } from "@/lib/reports/morning-run";

/**
 * The 08:30 IST morning report, Mon–Fri. Called by GitHub Actions at 08:15 IST and by Vercel Cron
 * at 08:30 IST as a backup; it sends at most once per day. &force=1 sends again (and on weekends).
 * Requires "Authorization: Bearer <CRON_SECRET>".
 */
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await sendMorningReport({ force: request.nextUrl.searchParams.get("force") === "1" });
    return Response.json(result, { status: result.status.startsWith("failed") ? 500 : 200 });
  } catch (error) {
    console.error("[morning-report] failed:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Morning report failed" }, { status: 500 });
  }
}
