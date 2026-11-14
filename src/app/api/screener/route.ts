import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { isMode } from "@/lib/modes";
import { runScreen } from "@/lib/screener";

// Scanning ~70 symbols takes 10–30 s on a cold cache.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const auth = await requireRole(request);
  if (auth instanceof Response) return auth;

  const mode = request.nextUrl.searchParams.get("mode");
  if (!isMode(mode)) {
    return Response.json({ error: "mode must be one of: intraday, short-term, long-term, options" }, { status: 400 });
  }
  const force = request.nextUrl.searchParams.get("refresh") === "1";

  try {
    return Response.json(await runScreen(mode, force));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Screen failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
