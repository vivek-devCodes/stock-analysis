import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { getServerWatchlist, hasServerWatchlist, setServerWatchlist } from "@/lib/watchlist-store";

// The watchlist the 08:30 morning report emails. The analyzer page saves every change here.

export async function GET(request: NextRequest) {
  const auth = await requireRole(request);
  if (auth instanceof Response) return auth;
  const [{ symbols, source }, saved] = await Promise.all([getServerWatchlist(), hasServerWatchlist()]);
  return Response.json({ symbols, source, saved });
}

export async function PUT(request: NextRequest) {
  const auth = await requireRole(request);
  if (auth instanceof Response) return auth;
  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.symbols)) return Response.json({ error: "symbols must be an array" }, { status: 400 });
  const symbols = await setServerWatchlist(body.symbols);
  return Response.json({ symbols });
}
