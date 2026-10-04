import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/server/auth";
import { authErrorPath, safeAuthReturnPath } from "@/lib/auth-navigation";
import { randomBytes } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The OAuth proxy has already issued app cookies. Verify them before returning to the app. */
export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("neon_popup") === "1") return popupBridge();
  const next = safeAuthReturnPath(request.nextUrl.searchParams.get("next"));
  let target = authErrorPath("oauth_session_failed", next);
  try {
    if (!request.nextUrl.searchParams.has("neon_auth_session_verifier") && await getSession()) target = next;
  } catch { target = authErrorPath("auth_unavailable", next); }
  const response = NextResponse.redirect(new URL(target, request.url));
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

/** Matches Neon's embedded OAuth protocol; send the one-time verifier only to this app's origin. */
function popupBridge(): Response {
  const nonce = randomBytes(24).toString("base64");
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Completing LEXRENT sign-in</title></head><body><p>Completing Google sign-in…</p><p><a href="/sign-in">Return to LEXRENT</a></p><script nonce="${nonce}">
(() => {
  const params = new URLSearchParams(window.location.search);
  const verifier = params.get("neon_auth_session_verifier");
  if (window.opener && !window.opener.closed) {
    window.opener.postMessage({ type: "neon-auth:oauth-complete", verifier: params.has("auth_error") || params.has("error") ? null : verifier }, window.location.origin);
    window.close();
    return;
  }
  // A popup reopened without its opener can complete through the ordinary callback.
  let destination = new URL("/auth/callback?next=%2F", window.location.origin);
  try {
    const candidate = new URL(params.get("neon_popup_callback") || destination.href, window.location.origin);
    if (candidate.origin === window.location.origin && candidate.pathname === "/auth/callback") destination = candidate;
  } catch {}
  destination.searchParams.delete("neon_popup");
  destination.searchParams.delete("neon_popup_callback");
  if (verifier && !params.has("auth_error") && !params.has("error")) destination.searchParams.set("neon_auth_session_verifier", verifier);
  else destination = new URL("/sign-in?auth_error=oauth_cancelled", window.location.origin);
  window.location.replace(destination.href);
})();
</script></body></html>`, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'self'`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
