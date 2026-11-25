import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { latestScreen, listScreens, runInsiderScreen, trackRecord } from "@/lib/insider/run";

export const maxDuration = 300;

/** The insider-buying screen (latest) and the strategy's track record. */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request);
  if (auth instanceof Response) return auth;
  try {
    const [screen, history] = await Promise.all([latestScreen(), listScreens(60)]);
    return Response.json({ screen, track: trackRecord(history), history: history.slice(0, 20).map((s) => ({ day: s.day, ready: s.buying.filter((p) => p.chart.verdict === "ready").map((p) => p.symbol), outcome: s.outcome ?? null })) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not load the insider screen" }, { status: 502 });
  }
}

/** Fetch the latest NSE disclosures and rebuild the screen now. */
export async function POST(request: NextRequest) {
  const auth = await requireRole(request);
  if (auth instanceof Response) return auth;
  try {
    return Response.json(await runInsiderScreen());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Insider screen failed" }, { status: 502 });
  }
}
