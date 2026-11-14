import { jwtVerify, SignJWT } from "jose";
import {
  getAuthSecret,
  JWT_AUDIENCE,
  JWT_ISSUER,
  ROLES,
  SESSION_TTL_SECONDS,
  type Role,
  type SessionUser,
} from "./config";

export async function signSession(user: SessionUser): Promise<string> {
  return new SignJWT({ role: user.role })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(user.username)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .setJti(crypto.randomUUID())
    .sign(getAuthSecret());
}

/** Returns the session user, or null when the token is missing, tampered with, expired or malformed. */
export async function verifySession(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getAuthSecret(), {
      algorithms: ["HS256"],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    const role = payload.role as Role;
    if (!payload.sub || !ROLES.includes(role)) return null;
    // Only the configured admin may hold a session. Renaming ADMIN_USERNAME ends old sessions.
    if (payload.sub !== process.env.ADMIN_USERNAME) return null;
    return { username: payload.sub, role };
  } catch {
    return null;
  }
}
