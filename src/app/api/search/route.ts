import { NextRequest } from "next/server";
import { searchSymbols } from "@/lib/yahoo";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim();
  if (!q) return Response.json({ results: [] });
  try {
    const results = await searchSymbols(q);
    return Response.json({ results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Search failed";
    return Response.json({ error: message, results: [] }, { status: 502 });
  }
}
