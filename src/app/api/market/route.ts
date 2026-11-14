import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { fetchIndexQuotes } from "@/lib/yahoo";

const INDICES = [
  "^NSEI",
  "^BSESN",
  "^NSEBANK",
  "^GSPC",
  "^IXIC",
  "^DJI",
  "BTC-USD",
];

export async function GET(request: NextRequest) {
  const auth = await requireRole(request);
  if (auth instanceof Response) return auth;
  try {
    const indices = await fetchIndexQuotes(INDICES);
    return Response.json({ indices, asOf: new Date().toISOString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Market snapshot failed";
    return Response.json({ error: message, indices: [] }, { status: 502 });
  }
}
