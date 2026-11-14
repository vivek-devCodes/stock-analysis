import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { getRecommendation } from "@/lib/db/repo";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request);
  if (auth instanceof Response) return auth;
  const { id } = await params;
  if (!/^REC-[A-Z0-9-]{6,80}$/i.test(id)) return Response.json({ error: "Invalid recommendation id." }, { status: 400 });
  try {
    const rec = await getRecommendation(id);
    if (!rec) return Response.json({ error: "Not found." }, { status: 404 });
    return Response.json(rec);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read recommendation";
    return Response.json({ error: message }, { status: 502 });
  }
}
