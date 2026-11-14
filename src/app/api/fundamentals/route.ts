import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { getFundamentals } from "@/lib/fundamentals";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const auth = await requireRole(request);
  if (auth instanceof Response) return auth;
  try {
    return Response.json(await getFundamentals());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Fundamentals failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
