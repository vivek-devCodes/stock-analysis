import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { paperSnapshot, runPaperAgent } from "@/lib/paper/engine";
import { buildNextSessionPlan } from "@/lib/paper/plan";
import { buildDailyReport } from "@/lib/paper/report";
import { istDate } from "@/lib/paper/rules";

// The agent run analyses up to 5 stocks with the full multi-agent pipeline.
export const maxDuration = 300;

/** Paper trades (open ones settled from the latest candles first), with live marks. */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request);
  if (auth instanceof Response) return auth;
  try {
    return Response.json(await paperSnapshot());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not load paper trades" }, { status: 502 });
  }
}

/**
 * { action: "run" }  — run the agent now and enter its intraday calls (manual).
 * { action: "auto" } — the page's auto mode; runs at most once per day, shared with the cron.
 * { action: "plan" } — build (or rebuild) the next-session intraday plan now (after the close).
 * { action: "report" } — build today's report now.
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(request);
  if (auth instanceof Response) return auth;
  const body = await request.json().catch(() => ({}));
  const action = body?.action;
  if (action === "plan" || action === "report") {
    try {
      if (action === "plan") return Response.json(await buildNextSessionPlan(true));
      const report = await buildDailyReport(istDate(Math.floor(Date.now() / 1000)), false);
      return Response.json(report ?? { error: "No paper trades or executed plan today." }, { status: report ? 200 : 404 });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : `${action} failed` }, { status: 502 });
    }
  }
  if (action !== "run" && action !== "auto") return Response.json({ error: "action must be run, auto, plan or report" }, { status: 400 });
  try {
    return Response.json(await runPaperAgent(action === "auto" ? "auto" : "manual"));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Agent run failed" }, { status: 502 });
  }
}
