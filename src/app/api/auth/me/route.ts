import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/guard";

export async function GET(request: NextRequest) {
  const user = await requireRole(request);
  if (user instanceof Response) return user;
  return Response.json({ user });
}
