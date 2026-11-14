import { NextResponse, type NextRequest } from "next/server";
import { isPublicPath, rolesFor, SESSION_COOKIE } from "@/lib/auth/config";
import { verifySession } from "@/lib/auth/jwt";

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");

  // CSRF: refuse state-changing requests sent from another site.
  if (request.method !== "GET" && request.method !== "HEAD") {
    const origin = request.headers.get("origin");
    let originHost: string | null = null;
    try {
      originHost = origin ? new URL(origin).host : null;
    } catch {
      originHost = "invalid";
    }
    if (originHost && originHost !== request.headers.get("host")) {
      return NextResponse.json({ error: "Cross-site request blocked" }, { status: 403 });
    }
  }

  const user = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);

  if (isPublicPath(pathname)) {
    // Already signed in: skip the login page.
    if (pathname === "/login" && user) return NextResponse.redirect(new URL("/", request.url));
    return NextResponse.next();
  }

  if (!user) {
    if (isApi) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const login = new URL("/login", request.url);
    if (pathname !== "/") login.searchParams.set("next", pathname + search);
    const res = NextResponse.redirect(login);
    // Clear a stale or tampered cookie.
    if (request.cookies.has(SESSION_COOKIE)) res.cookies.delete(SESSION_COOKIE);
    return res;
  }

  if (!rolesFor(pathname).includes(user.role)) {
    return isApi
      ? NextResponse.json({ error: "Forbidden" }, { status: 403 })
      : NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Everything except Next internals and static files in /public.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt)$).*)"],
};
