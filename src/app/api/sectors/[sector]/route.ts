import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { getSectorDetail } from "@/lib/insights/service";

export const maxDuration = 60;

export async function GET(request: NextRequest, { params }: { params: Promise<{ sector: string }> }) {
  const auth = await requireRole(request);
  if (auth instanceof Response) return auth;
  const { sector } = await params;
  if (!/^[A-Za-z]{2,20}$/.test(sector)) return Response.json({ error: "Invalid sector." }, { status: 400 });
  try {
    const detail = await getSectorDetail(sector);
    if (!detail) return Response.json({ error: "Unknown sector." }, { status: 404 });
    return Response.json(detail);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Sector data failed" }, { status: 502 });
  }
}
