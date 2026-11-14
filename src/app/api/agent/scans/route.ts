import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { runSession } from "@/lib/agents/run-session";
import { lastScanInMemory, recentScans, type ScanSession } from "@/lib/agents/scan";

export const maxDuration = 300;

/** Recent autonomous scans (from the database, or the last one in memory when there is none). */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request);
  if (auth instanceof Response) return auth;
  try {
    const runs = await recentScans(10);
    if (runs == null) {
      const last = lastScanInMemory();
      return Response.json({ persisted: false, runs: last ? [last] : [], note: "Connect DATABASE_URL to keep scan history across deployments." });
    }
    return Response.json({ persisted: true, runs });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not read scans", runs: [] }, { status: 502 });
  }
}

/** "Run scan now" from the AI Analyst page. Does not email (the scheduled sessions do). */
export async function POST(request: NextRequest) {
  const auth = await requireRole(request);
  if (auth instanceof Response) return auth;
  const body = await request.json().catch(() => ({}));
  const session = (body?.session ?? "postmarket") as ScanSession;
  if (!["premarket", "intraday", "postmarket"].includes(session)) return Response.json({ error: "Invalid session." }, { status: 400 });
  try {
    const { run } = await runSession(session, { email: false });
    return Response.json(run);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Scan failed" }, { status: 502 });
  }
}
