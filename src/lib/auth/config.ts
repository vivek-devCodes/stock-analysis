// Shared auth settings. Imported by proxy.ts and by route handlers, so it must not
// use Node-only APIs.

export const ROLES = ["admin"] as const;
export type Role = (typeof ROLES)[number];

export type SessionUser = {
  username: string;
  role: Role;
};

export const SESSION_COOKIE = "apex_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8 hours
export const JWT_ISSUER = "apex-desk";
export const JWT_AUDIENCE = "apex-desk-dashboard";

/**
 * Role policy: which roles may reach a path. The first matching prefix wins.
 * Any path not listed falls back to DEFAULT_ROLES. To add a role later, add it to
 * ROLES and list it against the paths it should reach.
 */
export const ROUTE_POLICIES: Array<{ prefix: string; roles: readonly Role[] }> = [
];
export const DEFAULT_ROLES: readonly Role[] = ["admin"];

/** Paths reachable without a session. Cron routes check their own CRON_SECRET. */
export const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/logout", "/api/cron/"];

export function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((p) => (p.endsWith("/") ? pathname.startsWith(p) : pathname === p));
}

export function rolesFor(pathname: string): readonly Role[] {
  return ROUTE_POLICIES.find((p) => pathname.startsWith(p.prefix))?.roles ?? DEFAULT_ROLES;
}

export function getAuthSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET ?? "";
  if (secret.length < 32) {
    throw new Error("AUTH_SECRET must be set to a random string of at least 32 characters.");
  }
  return new TextEncoder().encode(secret);
}
