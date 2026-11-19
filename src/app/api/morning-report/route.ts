import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { testEmailConnection } from "@/lib/email-service";
import { morningReportStatus, previewMorningReport, sendMorningReport } from "@/lib/reports/morning-run";

export const maxDuration = 300;

/**
 * GET              → today's report as a web page (preview, nothing is sent)
 * GET ?view=status → the last sends and an email-settings check
 * POST             → send the report now (manual test; the daily email is automatic)
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request);
  if (auth instanceof Response) return auth;
  if (request.nextUrl.searchParams.get("view") === "status") {
    const [history, email] = await Promise.all([morningReportStatus(), testEmailConnection()]);
    return Response.json({ history, email });
  }
  const report = await previewMorningReport();
  return new Response(report.html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(request);
  if (auth instanceof Response) return auth;
  const result = await sendMorningReport({ force: true });
  return Response.json(result, { status: result.status.startsWith("failed") ? 500 : 200 });
}
