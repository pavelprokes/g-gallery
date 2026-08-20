import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

// Next 16: proxy.ts replaces middleware.ts (which is deprecated and silently
// ignored). This is an OPTIMISTIC check only — cookie presence, not validity.
// Every admin page, Server Action, and Route Handler re-verifies the session
// via auth.api.getSession (see CLAUDE.md invariant #3).
export function proxy(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie) {
    const url = new URL("/sign-in", request.url);
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
