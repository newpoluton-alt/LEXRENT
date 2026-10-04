import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
// Next.js provides its request-context modules when the app runs. Database-only
// tests do not need that auth SDK runtime or a fabricated sign-in session.
vi.mock("@neondatabase/auth/next/server", () => ({ createNeonAuth: vi.fn() }));
import {
  createEvaluationRun, deleteSavedProperty, getDatabase, getEvaluationRun,
  listEvaluationRuns, listSavedProperties, saveProperty,
} from "../../src/server/db";
import type { AuthUser } from "../../src/server/auth";

// Opt-in only: this test writes temporary records to the configured database,
// then removes precisely the records belonging to its two random test owners.
describe.skipIf(process.env.RUN_NEON_INTEGRATION !== "1")("live Neon ownership", () => {
  it("persists snapshots while isolating the two temporary owners", async () => {
    const first: AuthUser = {
      id: `integration-${randomUUID()}`, email: "integration@example.invalid", name: null, emailVerified: false,
    };
    const second: AuthUser = { ...first, id: `integration-${randomUUID()}` };
    const addressId = `integration-${randomUUID()}`;
    const sql = getDatabase();
    try {
      const tables = await sql.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'lexrent_%'",
      );
      expect(tables.length).toBeGreaterThanOrEqual(7);
      const one = await createEvaluationRun(first, {
        asOf: "2026-10-01", inputs: { integration: true }, results: [],
      });
      const two = await createEvaluationRun(second, {
        asOf: "2026-10-02", inputs: { integration: true }, results: [],
      });
      expect((await getEvaluationRun(first, one.id))?.inputs).toEqual({ integration: true });
      expect(await getEvaluationRun(second, one.id)).toBeNull();
      expect((await listEvaluationRuns(first)).map((run) => run.id)).toEqual([one.id]);
      expect((await listEvaluationRuns(second)).map((run) => run.id)).toEqual([two.id]);
      await saveProperty(first, { addressId, snapshot: { integration: true } });
      expect((await listSavedProperties(first)).map((property) => property.addressId)).toEqual([addressId]);
      expect(await listSavedProperties(second)).toEqual([]);
      expect(await deleteSavedProperty(second, addressId)).toBe(false);
      expect(await deleteSavedProperty(first, addressId)).toBe(true);
    } finally {
      await sql.transaction([
        sql.query("DELETE FROM lexrent_saved_properties WHERE owner_user_id = ANY($1::text[])", [[first.id, second.id]]),
        sql.query("DELETE FROM lexrent_evaluation_runs WHERE owner_user_id = ANY($1::text[])", [[first.id, second.id]]),
        sql.query("DELETE FROM lexrent_audit_records WHERE actor_user_id = ANY($1::text[])", [[first.id, second.id]]),
      ]);
    }
  }, 30_000);
});
