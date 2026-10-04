import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn(), extract: vi.fn() }));
vi.mock("../../src/server/db", () => ({ getDatabase: () => ({ query: state.query, transaction: state.transaction }) }));
vi.mock("../../src/server/ai", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../src/server/ai")>()), extractSourceChunk: state.extract }));
vi.mock("@neondatabase/auth/next/server", () => ({ createNeonAuth: vi.fn() }));
import { extractWithPersistence, reserveAiRequest } from "../../src/server/extraction-store";
import { AiError, getExtractionIdentity, type ExtractionResult } from "../../src/server/ai";
import type { AuthUser } from "../../src/server/auth";
import type { SourceDocument } from "../../src/domain/types";
const admin: AuthUser = { id: "admin-1", email: "admin@example.test", name: null, emailVerified: true };
const source: SourceDocument = { doc_id: "TEST", jurisdictions: "NJ", url: "https://example.invalid/source", source_type: "test", capture: "yes", retrieved_at: "2026-10-01T00:00Z", sha256: "unused", text_file: "test", status: "ok", captured: true, text: "A sufficiently long captured synthetic source for persistence tests." };
function result(): ExtractionResult {
  const identity = getExtractionIdentity(source);
  return { bundle: { rules: [], ruleLogic: {} }, doc_id: "TEST", chunk: 0, total_chunks: 1, next_chunk: null, chunk_start: 0, chunk_end: source.text!.length, source_sha256: identity.source_hash, model: identity.model, prompt_version: identity.prompt_version, warnings: [], requires_review: true, cache_hit: false, usage: { input_tokens: 1, output_tokens: 1 }, created_at: "2026-10-01T00:00:00Z" };
}
beforeEach(() => { vi.stubEnv("LEXRENT_ADMIN_EMAILS", admin.email); vi.stubEnv("ANTHROPIC_API_KEY", "mock-only"); vi.stubEnv("CLAUDE_MODEL", ""); state.query.mockReset().mockResolvedValue([]); state.transaction.mockReset().mockResolvedValue([[], [{ id: "attempt-1" }]]); state.extract.mockReset().mockImplementation(async () => result()); });
afterEach(() => vi.unstubAllEnvs());
describe("durable extraction drafts and budget", () => {
  it("requires verified administrator identity and configured Claude before database access", async () => {
    await expect(extractWithPersistence(source, 0, { ...admin, emailVerified: false })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    await expect(extractWithPersistence(source, 0, admin)).rejects.toMatchObject({ code: "AI_NOT_CONFIGURED", status: 503 });
    expect(state.query).not.toHaveBeenCalled(); expect(state.extract).not.toHaveBeenCalled();
  });
  it("returns validated persistent cache without a new attempt or provider call", async () => {
    state.query.mockResolvedValue([{ result_json: result() }]);
    const cached = await extractWithPersistence(source, 0, admin);
    expect(cached.cache_hit).toBe(true);
    expect(state.transaction).not.toHaveBeenCalled(); expect(state.extract).not.toHaveBeenCalled();
  });
  it("serializes budget reservation and saves only a review-required draft", async () => {
    await extractWithPersistence(source, 0, admin);
    expect(state.transaction).toHaveBeenCalledTimes(1);
    expect(state.query.mock.calls[1]).toEqual([expect.stringContaining("pg_advisory_xact_lock"), [197505]]);
    const reserve = state.query.mock.calls[2];
    expect(reserve[0]).toContain("INSERT INTO lexrent_ai_requests"); expect(reserve[0]).toContain("RETURNING id");
    expect(reserve[1]).toEqual([admin.id, getExtractionIdentity(source).cache_key, 60, 200, "extraction"]);
    expect(reserve[0]).toContain("cache_key NOT LIKE 'chat:%'");
    expect(state.query.mock.calls[3][0]).toContain("INSERT INTO lexrent_ai_drafts");
    expect(state.query.mock.calls.every(([sql]) => !String(sql).includes("lexrent_rule_bundles"))).toBe(true);
  });
  it("does not call Claude when the serialized budget reservation is denied", async () => {
    state.transaction.mockResolvedValue([[], []]);
    await expect(extractWithPersistence(source, 0, admin)).rejects.toMatchObject({ code: "AI_RATE_LIMIT", status: 429 });
    expect(state.extract).not.toHaveBeenCalled();
    expect(state.query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO lexrent_ai_drafts"))).toBe(false);
  });
  it("counts provider failures as attempts without a refund or published record", async () => {
    state.extract.mockRejectedValue(new AiError("AI_UPSTREAM_ERROR", "Controlled failure"));
    await expect(extractWithPersistence(source, 0, admin)).rejects.toMatchObject({ code: "AI_UPSTREAM_ERROR" });
    expect(state.transaction).toHaveBeenCalledTimes(1);
    expect(state.query.mock.calls.some(([sql]) => /DELETE|lexrent_rule_bundles|INSERT INTO lexrent_ai_drafts/.test(String(sql)))).toBe(false);
  });
  it("fails closed when persistent storage is unavailable", async () => {
    state.query.mockRejectedValue(new Error("Sensitive DB details"));
    await expect(extractWithPersistence(source, 0, admin)).rejects.toMatchObject({ code: "AI_PERSISTENCE_UNAVAILABLE", status: 503 });
    expect(state.extract).not.toHaveBeenCalled();
  });
  it("uses the same global lock for an authenticated user's twenty-attempt chat budget", async () => {
    const user = { ...admin, id: "ordinary", email: "member@example.test", emailVerified: false };
    await reserveAiRequest(user, "chat:question-hash", { perUserLimit: 20, totalLimit: 200, requireAdmin: false });
    expect(state.query.mock.calls[0]).toEqual([expect.stringContaining("pg_advisory_xact_lock"), [197505]]);
    expect(state.query.mock.calls[1][1]).toEqual([user.id, "chat:question-hash", 20, 200, "chat"]);
    expect(state.query.mock.calls[1][0]).toContain("cache_key LIKE 'chat:%'");
    expect(state.transaction).toHaveBeenCalledTimes(1);
  });
});
