import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { getNews } from "@/lib/news/aggregate";
import { EXCLUDED_SOURCES } from "@/lib/news/sources";

// First crawl waits ~5 s per extra feed on the same host (politeness gap).
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const auth = await requireRole(request);
  if (auth instanceof Response) return auth;
  try {
    const snapshot = await getNews();
    return Response.json({ ...snapshot, excluded: EXCLUDED_SOURCES });
  } catch (error) {
    const message = error instanceof Error ? error.message : "News crawl failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
