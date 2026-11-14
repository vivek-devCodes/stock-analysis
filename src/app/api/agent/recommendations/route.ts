import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { listRecommendations } from "@/lib/db/repo";

export async function GET(request: NextRequest) {
  const auth = await requireRole(request);
  if (auth instanceof Response) return auth;
  try {
    const rows = await listRecommendations(200);
    if (rows == null) {
      return Response.json({ persisted: false, note: "Connect a Postgres database (DATABASE_URL) to keep recommendation history.", rows: [] });
    }
    return Response.json({ persisted: true, rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read history";
    return Response.json({ error: message, persisted: false, rows: [] }, { status: 502 });
  }
}
