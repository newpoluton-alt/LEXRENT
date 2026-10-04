import { NextResponse, type NextRequest } from "next/server";
import { getNeonAuth } from "./src/server/auth";
import { authErrorPath, safeAuthReturnPath } from "./src/lib/auth-navigation";

/** Neon OAuth returns a verifier, not a usable app session. The SDK must exchange it. */
export async function proxy(request: NextRequest) {
  if (!request.nextUrl.searchParams.has("neon_auth_session_verifier")) return NextResponse.next();
  // Embedded OAuth returns through a popup. Its verifier must reach the opener;
  // the opener then navigates through this proxy for the authenticated exchange.
  if (request.nextUrl.pathname === "/auth/callback" && request.nextUrl.searchParams.get("neon_popup") === "1") {
    const response = NextResponse.next();
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  }
  const next = safeAuthReturnPath(request.nextUrl.searchParams.get("next"));
  const fail = () => NextResponse.redirect(new URL(authErrorPath("oauth_session_failed", next), request.url));
  try {
    const response = await getNeonAuth().middleware({ loginUrl: "/sign-in" })(request);
    const location = response.headers.get("location");
    const target = location ? new URL(location, request.url) : null;
    // A successful SDK exchange redirects to the same app URL after removing the verifier.
    if (!target || target.origin !== request.nextUrl.origin || target.searchParams.has("neon_auth_session_verifier") || target.pathname === "/sign-in") {
      const failure = fail();
      for (const cookie of response.headers.getSetCookie()) failure.headers.append("Set-Cookie", cookie);
      failure.headers.set("Cache-Control", "no-store");
      failure.headers.set("Referrer-Policy", "no-referrer");
      return failure;
    }
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch {
    const failure = fail();
    failure.headers.set("Cache-Control", "no-store");
    failure.headers.set("Referrer-Policy", "no-referrer");
    return failure;
  }
}

export const config = {
  matcher: [{
    source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
    has: [{ type: "query", key: "neon_auth_session_verifier" }],
  }],
};
