import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only intercept the root path
  if (pathname !== "/") return NextResponse.next();

  const session = request.cookies.get("session");
  if (session?.value) {
    // Authenticated — let dashboard render
    return NextResponse.next();
  }

  // Unauthenticated — rewrite to marketing landing page
  const url = request.nextUrl.clone();
  url.pathname = "/landing";
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/"],
};
