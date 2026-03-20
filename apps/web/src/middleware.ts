import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const publicRoutes = ["/login", "/signup"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = request.cookies.get("session");

  const isPublicRoute = publicRoutes.some((route) => pathname.startsWith(route));
  const isApiRoute = pathname.startsWith("/api");

  // Skip API routes
  if (isApiRoute) return NextResponse.next();

  // Logged in user trying to visit login/signup → redirect to dashboard
  if (isPublicRoute && session) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // Not logged in trying to visit protected route → redirect to login
  if (!isPublicRoute && !session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
