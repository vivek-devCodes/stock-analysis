import type { NextRequest } from "next/server";
import { SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/auth/config";
import { clientIp } from "@/lib/auth/guard";
import { signSession } from "@/lib/auth/jwt";
import { safeEqual, verifyPassword } from "@/lib/auth/password";
import { clearFailures, isLocked, recordFailure } from "@/lib/auth/rate-limit";

// Used when the username is wrong, so a bad username costs the same scrypt time as a bad password.
const DUMMY_HASH =
  "scrypt:00000000000000000000000000000000:" + "0".repeat(128);

export async function POST(request: NextRequest) {
  const ip = clientIp(request);
  const lockedFor = isLocked(ip);
  if (lockedFor) {
    return Response.json(
      { error: `Too many failed attempts. Try again in ${Math.ceil(lockedFor / 60)} min.` },
      { status: 429, headers: { "Retry-After": String(lockedFor) } },
    );
  }

  const adminUser = process.env.ADMIN_USERNAME;
  const adminHash = process.env.ADMIN_PASSWORD_HASH;
  if (!adminUser || !adminHash || !process.env.AUTH_SECRET) {
    console.error("[auth] ADMIN_USERNAME, ADMIN_PASSWORD_HASH and AUTH_SECRET must all be set.");
    return Response.json({ error: "Login is not configured on the server." }, { status: 500 });
  }

  let body: { username?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || !password || username.length > 100 || password.length > 200) {
    return Response.json({ error: "Username and password are required." }, { status: 400 });
  }

  const userOk = safeEqual(username, adminUser);
  const passOk = await verifyPassword(password, userOk ? adminHash : DUMMY_HASH);
  if (!userOk || !passOk) {
    recordFailure(ip);
    return Response.json({ error: "Invalid username or password." }, { status: 401 });
  }

  clearFailures(ip);
  const token = await signSession({ username: adminUser, role: "admin" });
  const res = Response.json({ ok: true, user: { username: adminUser, role: "admin" } });
  res.headers.append(
    "Set-Cookie",
    [
      `${SESSION_COOKIE}=${token}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${SESSION_TTL_SECONDS}`,
      process.env.NODE_ENV === "production" ? "Secure" : "",
    ]
      .filter(Boolean)
      .join("; "),
  );
  return res;
}
