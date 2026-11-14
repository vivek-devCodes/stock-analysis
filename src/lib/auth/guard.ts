import "server-only";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, type Role, type SessionUser } from "./config";
import { verifySession } from "./jwt";

/**
 * Second line of defence inside route handlers (proxy.ts is the first).
 * Returns the user, or a 401/403 Response to send back as-is.
 */
export async function requireRole(
  request: NextRequest,
  roles: readonly Role[] = ["admin"],
): Promise<SessionUser | Response> {
  const user = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!roles.includes(user.role)) return Response.json({ error: "Forbidden" }, { status: 403 });
  return user;
}

export function clientIp(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}
