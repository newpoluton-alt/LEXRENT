/** Keep authentication return URLs on this app, including property/workspace context. */
export function safeAuthReturnPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value)) return "/";
  try {
    const origin = "https://lexrent.example";
    const url = new URL(value, origin);
    if (url.origin !== origin) return "/";
    if (url.pathname === "/auth/callback") return "/";
    // Never forward one-time OAuth credentials into pages, analytics, or links.
    url.searchParams.delete("neon_auth_session_verifier");
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return "/"; }
}

export function authCallbackPath(next: string): string {
  return `/auth/callback?${new URLSearchParams({ next: safeAuthReturnPath(next) })}`;
}

export function authErrorPath(code: string, next: string = "/"): string {
  return `/sign-in?${new URLSearchParams({ auth_error: code, next: safeAuthReturnPath(next) })}`;
}
