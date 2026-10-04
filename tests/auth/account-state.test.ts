import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());
const response = (name: string | null) => Response.json({ user: name === null ? null : { id: "test-user", name, email: "test@example.invalid", emailVerified: true }, auth_configured: true, is_admin: false });

describe("shared server-verified account state", () => {
  it("performs a fresh post-sign-in check after an older anonymous request finishes", async () => {
    let finish: (response: Response) => void = () => {};
    const oldRequest = new Promise<Response>(resolve => { finish = resolve; });
    const fetch = vi.fn().mockReturnValueOnce(oldRequest).mockResolvedValueOnce(response("Test Person"));
    vi.stubGlobal("fetch", fetch);
    const { refreshAccount, getAccountSnapshot } = await import("../../src/lib/account-state");
    const anonymous = refreshAccount();
    const signedIn = refreshAccount(true);
    expect(fetch).toHaveBeenCalledOnce();
    finish(response(null));
    await anonymous;
    expect((await signedIn).user?.name).toBe("Test Person");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(getAccountSnapshot().user?.name).toBe("Test Person");
    expect(fetch.mock.calls[1][1]).toMatchObject({ cache: "no-store", credentials: "same-origin" });
  });
  it("clears identity and admin UI privileges when verification fails or the session is revoked", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response("Test Person")).mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValueOnce(response(null)));
    const { refreshAccount } = await import("../../src/lib/account-state");
    expect((await refreshAccount()).user).not.toBeNull();
    expect(await refreshAccount()).toMatchObject({ user: null, is_admin: false, error: true });
    expect(await refreshAccount()).toMatchObject({ user: null, is_admin: false, error: false });
  });
  it("queues an incoming cross-tab change past an older request without rebroadcasting", async () => {
    let finish: (response: Response) => void = () => {};
    const fetch = vi.fn().mockReturnValueOnce(new Promise<Response>(resolve => { finish = resolve; })).mockResolvedValueOnce(response("Changed Account"));
    vi.stubGlobal("fetch", fetch);
    const { refreshAccount } = await import("../../src/lib/account-state");
    const older = refreshAccount();
    const changed = refreshAccount(false, true);
    finish(response(null));
    await older;
    expect((await changed).user?.name).toBe("Changed Account");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("uses the actual full name and falls back to email for older unnamed accounts", async () => {
    const { accountDisplayName } = await import("../../src/lib/account-state");
    expect(accountDisplayName({ name: "  Test Person  ", email: "test@example.invalid" })).toBe("Test Person");
    expect(accountDisplayName({ name: null, email: "test@example.invalid" })).toBe("test@example.invalid");
    expect(accountDisplayName({ name: "  ", email: "test@example.invalid" })).toBe("test@example.invalid");
  });
});
