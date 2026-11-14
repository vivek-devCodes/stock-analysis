import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { getSectors } from "@/lib/insights/service";

// First call fetches ~80 daily series; cached for 10 minutes afterwards.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const auth = await requireRole(request);
  if (auth instanceof Response) return auth;
  try {
    return Response.json(await getSectors());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Sector data failed" }, { status: 502 });
  }
}
