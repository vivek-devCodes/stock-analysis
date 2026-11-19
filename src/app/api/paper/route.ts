import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { paperSnapshot, runPaperAgent } from "@/lib/paper/engine";

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
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole(request);
  if (auth instanceof Response) return auth;
  const body = await request.json().catch(() => ({}));
  const action = body?.action;
  if (action !== "run" && action !== "auto") return Response.json({ error: "action must be run or auto" }, { status: 400 });
  try {
    return Response.json(await runPaperAgent(action === "auto" ? "auto" : "manual"));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Agent run failed" }, { status: 502 });
  }
}
