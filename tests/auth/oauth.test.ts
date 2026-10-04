import { runInNewContext } from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const auth = vi.hoisted(() => ({ middleware: vi.fn(), getSession: vi.fn() }));
vi.mock("../../src/server/auth", () => ({
  getNeonAuth: () => ({ middleware: () => auth.middleware }),
  getSession: auth.getSession,
}));
import { proxy } from "../../proxy";
import { GET } from "../../app/auth/callback/route";
import { authCallbackPath, safeAuthReturnPath } from "../../src/lib/auth-navigation";

const origin = "https://lexrent.test";
beforeEach(() => { auth.middleware.mockReset(); auth.getSession.mockReset(); });

describe("safe authentication navigation", () => {
  it("preserves property context and removes one-time OAuth credentials", () => {
    const path = "/?address_id=A0001&as_of=2026-10-01&neon_auth_session_verifier=one-time#summary";
    expect(safeAuthReturnPath(path)).toBe("/?address_id=A0001&as_of=2026-10-01#summary");
    expect(authCallbackPath(path)).toContain("next=%2F%3Faddress_id%3DA0001");
    expect(authCallbackPath(path)).not.toContain("one-time");
  });
  it("rejects external, protocol-relative and browser-normalized redirect escapes", () => {
    for (const path of ["https://attacker.test", "//attacker.test", "/\\attacker.test", "/\n/attacker.test", "javascript:alert(1)", "/auth/callback?next=%2Fauth%2Fcallback"]) expect(safeAuthReturnPath(path)).toBe("/");
  });
});

describe("Neon OAuth completion", () => {
  it("leaves ordinary public pages untouched", async () => {
    const response = await proxy(new NextRequest(`${origin}/rights`));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(auth.middleware).not.toHaveBeenCalled();
  });
  it("preserves both SDK cookies and the verifier-free callback redirect", async () => {
    const request = new NextRequest(`${origin}/auth/callback?next=%2F%3Faddress_id%3DA0001&neon_auth_session_verifier=one-time`);
    const upstream = NextResponse.redirect(new URL(`${origin}/auth/callback?next=%2F%3Faddress_id%3DA0001`));
    upstream.headers.append("Set-Cookie", "__Secure-neon-auth.session_token=test-only; Path=/; HttpOnly; Secure; SameSite=Lax");
    upstream.headers.append("Set-Cookie", "__Secure-neon-auth.local.session_data=test-only-cache; Path=/; HttpOnly; Secure; SameSite=Lax");
    auth.middleware.mockResolvedValue(upstream);
    const response = await proxy(request);
    expect(response.headers.getSetCookie()).toHaveLength(2);
    expect(response.headers.get("location")).toBe(`${origin}/auth/callback?next=%2F%3Faddress_id%3DA0001`);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
  it("fails closed for absent or expired challenges without forwarding the verifier", async () => {
    for (const result of [NextResponse.next(), NextResponse.redirect(new URL(`${origin}/sign-in?neon_auth_session_verifier=one-time`))]) {
      auth.middleware.mockResolvedValueOnce(result);
      const response = await proxy(new NextRequest(`${origin}/auth/callback?next=%2Fworkspace&neon_auth_session_verifier=one-time`));
      expect(response.headers.get("location")).toContain("auth_error=oauth_session_failed");
      expect(response.headers.get("location")).not.toContain("one-time");
      expect(response.headers.get("location")).toContain("next=%2Fworkspace");
    }
  });
  it("verifies a live app session before returning to the original page", async () => {
    auth.getSession.mockResolvedValueOnce({ user: { id: "test-user" } }).mockResolvedValueOnce(null);
    const request = new NextRequest(`${origin}/auth/callback?next=%2F%3Faddress_id%3DA0001`);
    expect((await GET(request)).headers.get("location")).toBe(`${origin}/?address_id=A0001`);
    expect((await GET(request)).headers.get("location")).toContain("auth_error=oauth_session_failed");
  });
});

async function popupScript(query: string) {
  const url = `${origin}/auth/callback?neon_popup=1&${query}`;
  const request = new NextRequest(url);
  const response = await GET(request);
  const html = await response.text();
  const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)![1];
  return { url, response, script, html };
}

describe("embedded Google OAuth popup bridge", () => {
  it("leaves the popup verifier for the opener to exchange and sends only to the exact app origin", async () => {
    const request = new NextRequest(`${origin}/auth/callback?neon_popup=1&neon_auth_session_verifier=one-time`);
    expect((await proxy(request)).headers.get("x-middleware-next")).toBe("1");
    expect(auth.middleware).not.toHaveBeenCalled();
    const bridge = await popupScript("neon_auth_session_verifier=one-time");
    const postMessage = vi.fn(), close = vi.fn();
    runInNewContext(bridge.script, { URL, URLSearchParams, window: { opener: { closed: false, postMessage }, close, location: { origin, search: new URL(bridge.url).search } } });
    expect(postMessage).toHaveBeenCalledWith({ type: "neon-auth:oauth-complete", verifier: "one-time" }, origin);
    expect(close).toHaveBeenCalledOnce();
    expect(bridge.response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(bridge.response.headers.get("cache-control")).toBe("no-store");
    expect(bridge.html).not.toContain("one-time");
  });
  it("reports cancellation without leaking or inventing a verifier", async () => {
    const bridge = await popupScript("auth_error=oauth_cancelled&neon_auth_session_verifier=discard-this");
    const postMessage = vi.fn();
    runInNewContext(bridge.script, { URL, URLSearchParams, window: { opener: { closed: false, postMessage }, close: vi.fn(), location: { origin, search: new URL(bridge.url).search } } });
    expect(postMessage).toHaveBeenCalledWith({ type: "neon-auth:oauth-complete", verifier: null }, origin);
  });
  it("uses the ordinary same-origin callback if the opener is absent, even with a hostile callback URL", async () => {
    const bridge = await popupScript("neon_auth_session_verifier=one-time&neon_popup_callback=https%3A%2F%2Fattacker.test%2Fauth%2Fcallback");
    const replace = vi.fn();
    runInNewContext(bridge.script, { URL, URLSearchParams, window: { opener: null, location: { origin, search: new URL(bridge.url).search, replace } } });
    const destination = new URL(replace.mock.calls[0][0]);
    expect(destination.origin).toBe(origin);
    expect(destination.pathname).toBe("/auth/callback");
    expect(destination.searchParams.get("neon_auth_session_verifier")).toBe("one-time");
    expect(destination.searchParams.has("neon_popup")).toBe(false);
  });
});
