import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { getStockInsight } from "@/lib/insights/service";
import { normaliseSymbol } from "@/lib/agents/data";

export async function GET(request: NextRequest) {
  const auth = await requireRole(request);
  if (auth instanceof Response) return auth;
  const raw = request.nextUrl.searchParams.get("symbol") ?? "";
  if (!/^[A-Za-z0-9^][A-Za-z0-9.\-=&^]{0,24}$/.test(raw)) return Response.json({ error: "Invalid symbol." }, { status: 400 });
  try {
    return Response.json(await getStockInsight(normaliseSymbol(raw)));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Insight failed" }, { status: 502 });
  }
}
