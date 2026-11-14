import { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { fetchChart } from "@/lib/yahoo";

export async function GET(request: NextRequest) {
  const auth = await requireRole(request);
  if (auth instanceof Response) return auth;
  const symbol = request.nextUrl.searchParams.get("symbol")?.trim();
  if (!symbol) {
    return Response.json({ error: "symbol is required" }, { status: 400 });
  }
  try {
    const { quote } = await fetchChart(symbol, "5d");
    return Response.json({ quote });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Quote failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
