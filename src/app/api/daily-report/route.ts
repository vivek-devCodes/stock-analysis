import { NextRequest } from "next/server";
import { runDailyAnalysis } from "@/scripts/daily-analysis";
import { testEmailConnection } from "@/lib/email-service";

export async function GET(request: NextRequest) {
  const action = request.nextUrl.searchParams.get("action");

  if (action === "test-email") {
    try {
      const ok = await testEmailConnection();
      return Response.json({ success: ok, message: ok ? "SMTP connection verified" : "SMTP connection failed" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "SMTP check error";
      return Response.json({ success: false, error: message }, { status: 500 });
    }
  }

  return Response.json({
    status: "ready",
    info: "Use POST /api/daily-report to trigger the LLM market scan and dispatch the email recommendation report.",
    cronSchedule: "Daily at 08:45 AM IST (03:15 AM UTC)",
  });
}

export async function POST(request: NextRequest) {
  try {
    const report = await runDailyAnalysis();
    return Response.json({
      success: true,
      report,
      message: "Daily LLM Stock Analysis executed and dispatched successfully.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pipeline execution failed";
    console.error("[DailyReport API] Error:", error);
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
