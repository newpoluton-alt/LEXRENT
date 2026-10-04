import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const provider = vi.hoisted(() => ({ getSession: vi.fn(), create: vi.fn() }));

vi.mock("@neondatabase/auth/next/server", () => ({
  createNeonAuth: (configuration: unknown) => {
    provider.create(configuration);
    return { getSession: provider.getSession };
  },
}));

import {
  assertSameOrigin,
  authErrorResponse,
  getSession,
  isAdmin,
  requireAdmin,
  requireUser,
  type AuthUser,
} from "../../src/server/auth";

const verifiedUser: AuthUser = {
  id: "neon-user-1", email: "Admin@Example.test", name: "Administrator", emailVerified: true,
};

function activeSession(user = verifiedUser) {
  return {
    data: { user, session: { id: "session-1", expiresAt: new Date(Date.now() + 60_000) } },
    error: null,
  };
}

beforeEach(() => {
  vi.stubEnv("NEON_AUTH_BASE_URL", "https://project.neonauth.test/neondb/auth");
  vi.stubEnv("NEON_AUTH_COOKIE_SECRET", "a-secret-with-at-least-thirty-two-characters");
  vi.stubEnv("LEXRENT_ADMIN_EMAILS", " admin@example.test, second@example.test ");
  provider.getSession.mockReset();
  provider.create.mockClear();
});

afterEach(() => vi.unstubAllEnvs());

describe("server session authorization", () => {
  it("keeps public reads available but rejects protected writes without auth configuration", async () => {
    vi.stubEnv("NEON_AUTH_BASE_URL", "");
    expect(await getSession()).toBeNull();
    await expect(requireUser()).rejects.toMatchObject({ code: "AUTH_NOT_CONFIGURED", status: 503 });
    expect(provider.getSession).not.toHaveBeenCalled();
  });

  it("requires a real upstream session and bypasses the signed cookie cache", async () => {
    provider.getSession.mockResolvedValue(activeSession());
    expect(await requireUser()).toEqual(verifiedUser);
    expect(provider.getSession).toHaveBeenCalledWith({ query: { disableCookieCache: "true" } });
  });

  it("rejects signed-out, revoked, and expired sessions", async () => {
    provider.getSession.mockResolvedValueOnce({ data: null, error: null });
    await expect(requireUser()).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
    provider.getSession.mockResolvedValueOnce({ data: null, error: { status: 401 } });
    await expect(requireUser()).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
    const expired = activeSession();
    expired.data.session.expiresAt = new Date(Date.now() - 60_000);
    provider.getSession.mockResolvedValueOnce(expired);
    await expect(requireUser()).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
  });

  it("fails closed when Neon is unreachable, without disclosing provider errors", async () => {
    provider.getSession.mockRejectedValue(new Error("private connection credentials"));
    try {
      await requireUser();
      throw new Error("Expected authorization to fail");
    } catch (error) {
      const response = authErrorResponse(error);
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const body = await response.text();
      expect(body).toContain("AUTH_UNAVAILABLE");
      expect(body).not.toContain("credentials");
    }
  });

  it("authorizes administrators only with a verified, server-allowlisted email", async () => {
    expect(isAdmin({ ...verifiedUser, emailVerified: false })).toBe(false);
    expect(isAdmin({ ...verifiedUser, email: "other@example.test" })).toBe(false);
    expect(isAdmin(verifiedUser)).toBe(true);
    provider.getSession.mockResolvedValue(activeSession({ ...verifiedUser, emailVerified: false }));
    await expect(requireAdmin()).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    provider.getSession.mockResolvedValue(activeSession());
    expect(await requireAdmin()).toEqual(verifiedUser);
  });

  it("does not trust a client or provider role claiming administrator access", async () => {
    provider.getSession.mockResolvedValue(activeSession({
      ...verifiedUser, email: "ordinary@example.test", role: "admin",
    } as AuthUser));
    await expect(requireAdmin()).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });
});

describe("write origin protection", () => {
  it("accepts app writes and rejects cross-site writes before verifying a session", async () => {
    assertSameOrigin(new Request("https://lexrent.test/api/saved", {
      method: "POST", headers: { origin: "https://lexrent.test" },
    }));
    await expect(requireUser(new Request("https://lexrent.test/api/saved", {
      method: "POST", headers: { origin: "https://attacker.test" },
    }))).rejects.toMatchObject({ code: "INVALID_ORIGIN", status: 403 });
    expect(provider.getSession).not.toHaveBeenCalled();
  });

  it("rejects cross-site browser writes even without an Origin header", () => {
    expect(() => assertSameOrigin(new Request("https://lexrent.test/api/saved", {
      method: "DELETE", headers: { "sec-fetch-site": "cross-site" },
    }))).toThrowError("This request must come from the LEXRENT app.");
  });
});
