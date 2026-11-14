import type { NextRequest } from "next/server";
import { evaluateOpenRecommendations } from "@/lib/agents/evaluate";
import { safeEqual } from "@/lib/auth/password";

// Called by Vercel Cron after the market closes; records whether open recommendations hit their
// stop or target (performance tracking). Requires "Authorization: Bearer <CRON_SECRET>".
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return Response.json(await evaluateOpenRecommendations());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Evaluation failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
