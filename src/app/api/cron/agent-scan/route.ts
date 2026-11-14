import type { NextRequest } from "next/server";
import { safeEqual } from "@/lib/auth/password";
import { runSession } from "@/lib/agents/run-session";
import type { ScanSession } from "@/lib/agents/scan";

// Autonomous agent sessions. Vercel Cron calls pre-market and post-market; a GitHub Actions
// schedule (or any scheduler) can call ?session=intraday during market hours.
// Requires "Authorization: Bearer <CRON_SECRET>".
export const maxDuration = 300;

const SESSIONS: ScanSession[] = ["premarket", "intraday", "postmarket"];

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const session = request.nextUrl.searchParams.get("session") as ScanSession | null;
  if (!session || !SESSIONS.includes(session)) {
    return Response.json({ error: "session must be premarket, intraday or postmarket" }, { status: 400 });
  }
  try {
    const { run, evaluation, email } = await runSession(session, { email: true });
    return Response.json({ id: run.id, session, counts: run.counts, horizons: run.horizons.map((h) => ({ horizon: h.horizon, analysed: h.items.length })), evaluation, email, note: run.note, errors: run.errors.slice(0, 5) });
  } catch (error) {
    console.error("[agent-scan] failed:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Scan failed" }, { status: 500 });
  }
}
