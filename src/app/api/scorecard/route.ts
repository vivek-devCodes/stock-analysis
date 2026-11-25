import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { runHealthCheck } from "@/lib/learn/health";
import { getScorecard, runLearning } from "@/lib/learn/scorecard";
import { getLearned } from "@/lib/learn/store";
import { DRAWDOWN_RESET_FLAG } from "@/lib/paper/guard";
import { setFlag } from "@/lib/paper/store";

export const maxDuration = 120;

/** The learning loop's scorecard: signals, agents, calibration, baselines, risk state, health. */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request);
  if (auth instanceof Response) return auth;
  try {
    const [card, health] = await Promise.all([getScorecard(), getLearned("health").catch(() => null)]);
    return Response.json({ ...card, health: health?.data ?? null });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not build the scorecard" }, { status: 502 });
  }
}

/**
 * { action: "resume" } — resume recommended trades after a drawdown pause (drawdown is measured from now).
 * { action: "learn" }  — run the learning step now (scores any unscored NSE days).
 * { action: "health" } — run the health check now (no alert).
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(request);
  if (auth instanceof Response) return auth;
  const action = (await request.json().catch(() => ({})))?.action;
  try {
    if (action === "resume") {
      await setFlag(DRAWDOWN_RESET_FLAG, { by: auth.username });
      return Response.json({ ok: true });
    }
    if (action === "learn") return Response.json(await runLearning());
    if (action === "health") return Response.json(await runHealthCheck({ alert: false }));
    return Response.json({ error: "action must be resume, learn or health" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : `${action} failed` }, { status: 502 });
  }
}
