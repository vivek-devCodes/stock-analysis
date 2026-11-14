import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { getLiveQuotes } from "@/lib/live";
import { parseSymbolList, sanitizeSymbols } from "@/lib/symbols";

export async function GET(request: NextRequest) {
  const auth = await requireRole(request);
  if (auth instanceof Response) return auth;

  const symbols = sanitizeSymbols(parseSymbolList(request.nextUrl.searchParams.get("symbols") ?? undefined));
  if (!symbols.length) return Response.json({ error: "symbols is required" }, { status: 400 });

  try {
    const quotes = await getLiveQuotes(symbols);
    return Response.json({ quotes, asOf: new Date().toISOString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Live quotes failed";
    return Response.json({ error: message, quotes: [] }, { status: 502 });
  }
}
