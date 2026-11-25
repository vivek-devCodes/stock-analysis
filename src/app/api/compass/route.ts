import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { compassHistory, currentCompass } from "@/lib/compass/fetch";

/** Market Compass: opening bias, volatility regime, the checklist, global market tiles, track record. */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request);
  if (auth instanceof Response) return auth;
  try {
    const force = request.nextUrl.searchParams.get("refresh") === "1";
    const [now, history] = await Promise.all([currentCompass(force), compassHistory(60).catch(() => null)]);
    return Response.json({ ...now, history });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not build the compass" }, { status: 502 });
  }
}
