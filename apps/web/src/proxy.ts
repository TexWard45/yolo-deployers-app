import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const publicRoutes = ["/login", "/signup", "/landing"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = request.cookies.get("session");

  const isPublicRoute = publicRoutes.some((route) => pathname.startsWith(route));
  const isApiRoute = pathname.startsWith("/api");

  // Skip API routes
  if (isApiRoute) return NextResponse.next();

  // Unauthenticated user at root → show landing page
  if (pathname === "/" && !session) {
    return NextResponse.rewrite(new URL("/landing", request.url));
  }

  // Logged in user trying to visit login/signup → redirect to dashboard
  // But allow /landing for everyone
  if (isPublicRoute && session && pathname !== "/landing") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // Not logged in trying to visit protected route → redirect to login
  if (!isPublicRoute && !session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|images).*)"],
};
