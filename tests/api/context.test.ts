import { describe, expect, it, vi } from "vitest";
vi.mock("../../src/server/db", () => ({ isDatabaseConfigured: () => true, getLatestRuleBundle: vi.fn(), listSourceCaptures: vi.fn(async () => []), getJurisdictionResolutions: vi.fn(async () => ({})), DatabaseError: class extends Error { constructor(public code: string, message: string, public status: number) { super(message); } } }));
import { getLatestRuleBundle } from "../../src/server/db";
import { loadContext } from "../../src/server/context";
import { sources } from "../../src/domain";
describe("rule evidence repair", () => {
  it("blocks legal evaluation while leaving source inspection and administrator repair available", async () => {
    vi.mocked(getLatestRuleBundle).mockResolvedValue({ id: "bad", name: "old version", sourceFile: null, sha256: "hash", rules: [{ team_rule_id: "old" }], metadata: {}, verifiedByUserId: "admin", createdAt: "2026-10-01" });
    await expect(loadContext()).rejects.toThrow("needs evidence review");
    const repaired = await loadContext({ allowEvidenceRepair: true });
    expect(repaired.evidenceNeedsReview).toBe(true); expect(repaired.context.sources).toHaveLength(sources.length);
    expect(repaired.context.rules?.[0].team_rule_id).toBe("old");
  });
});
