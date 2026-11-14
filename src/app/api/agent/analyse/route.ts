import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { runAnalysis } from "@/lib/agents/graph";
import { HORIZONS, type AnalyseRequest } from "@/lib/agents/types";

// Data collection fans out to ~20 requests; the optional Gemini review adds up to 25 s.
export const maxDuration = 60;

const SYMBOL_RE = /^[A-Za-z0-9^][A-Za-z0-9.\-=&^]{0,24}$/;

export async function POST(request: NextRequest) {
  const auth = await requireRole(request);
  if (auth instanceof Response) return auth;

  let body: Partial<AnalyseRequest>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const symbol = typeof body.symbol === "string" ? body.symbol.trim() : "";
  if (!SYMBOL_RE.test(symbol)) return Response.json({ error: "Enter a valid symbol, e.g. RELIANCE or TCS.NS." }, { status: 400 });
  if (!HORIZONS.some((h) => h.id === body.horizon)) return Response.json({ error: "horizon must be intraday, swing or long-term." }, { status: 400 });
  const capital = typeof body.capital === "number" && body.capital > 0 && body.capital < 1e12 ? body.capital : null;
  const riskPct = typeof body.riskPct === "number" && body.riskPct > 0 && body.riskPct <= 100 ? body.riskPct : null;

  try {
    const report = await runAnalysis({ symbol, horizon: body.horizon!, capital, riskPct });
    return Response.json(report);
  } catch (error) {
    console.error("[agent] analysis failed:", error);
    const message = error instanceof Error ? error.message : "Analysis failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
