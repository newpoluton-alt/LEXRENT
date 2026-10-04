import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@neondatabase/serverless", () => ({ neon: () => ({ query: database.query }) }));
vi.mock("@neondatabase/auth/next/server", () => ({ createNeonAuth: vi.fn() }));

import {
  createEvaluationRun,
  deleteSavedProperty,
  getEvaluationRun,
  listEvaluationRuns,
  listSavedProperties,
  saveRuleBundle,
} from "../../src/server/db";
import type { AuthUser } from "../../src/server/auth";

const user: AuthUser = { id: "user-a", email: "a@example.test", name: null, emailVerified: true };
const recordId = "c2f7c1a0-bfbc-45ae-9c31-56d55792733d";

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "postgresql://unused.test/test");
  vi.stubEnv("LEXRENT_ADMIN_EMAILS", "admin@example.test");
  database.query.mockReset().mockResolvedValue([]);
});
afterEach(() => vi.unstubAllEnvs());

describe("private persistence boundaries", () => {
  it("scopes saved-property and evaluation reads to the verified account", async () => {
    await listSavedProperties(user);
    expect(database.query).toHaveBeenLastCalledWith(
      expect.stringContaining("WHERE owner_user_id = $1"), [user.id],
    );
    await listEvaluationRuns(user);
    expect(database.query).toHaveBeenLastCalledWith(
      expect.stringContaining("WHERE owner_user_id = $1"), [user.id],
    );
    expect(await getEvaluationRun(user, recordId)).toBeNull();
    expect(database.query).toHaveBeenLastCalledWith(
      expect.stringContaining("AND owner_user_id = $2"), [recordId, user.id],
    );
  });

  it("cannot delete another account's saved property and parameterizes its ID", async () => {
    const hostileId = "' OR 1=1 --";
    expect(await deleteSavedProperty(user, hostileId)).toBe(false);
    const [statement, parameters] = database.query.mock.calls[0];
    expect(statement).toContain("WHERE owner_user_id = $1 AND address_id = $2");
    expect(statement).not.toContain(hostileId);
    expect(parameters).toEqual([user.id, hostileId]);
  });

  it("rejects rule imports by an ordinary or unverified account before database access", async () => {
    await expect(saveRuleBundle(user, { name: "Untrusted bundle", rules: [{}] }))
      .rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    await expect(saveRuleBundle({ ...user, email: "admin@example.test", emailVerified: false }, {
      name: "Unverified bundle", rules: [{}],
    })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(database.query).not.toHaveBeenCalled();
  });

  it("rejects invalid calendar dates with a controlled error", async () => {
    for (const asOf of ["2026-13-01", "2026-02-30", "not-a-date"]) {
      await expect(createEvaluationRun(user, { asOf, inputs: [], results: [] }))
        .rejects.toMatchObject({ code: "INVALID_INPUT", status: 400 });
    }
    expect(database.query).not.toHaveBeenCalled();
  });

  it("fails closed for saving when the database is missing", async () => {
    vi.stubEnv("DATABASE_URL", "");
    await expect(listSavedProperties(user)).rejects.toMatchObject({ code: "DATABASE_NOT_CONFIGURED", status: 503 });
    expect(database.query).not.toHaveBeenCalled();
  });
});
