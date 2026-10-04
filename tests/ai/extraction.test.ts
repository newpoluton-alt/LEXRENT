import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { createMessage } = vi.hoisted(() => ({ createMessage: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { create: createMessage }; } }));
import { AiError, chunkSourceText, clearExtractionCache, extractSourceChunk, isAiConfigured, recoverCapturedQuote } from "../../src/server/ai";
import type { SourceDocument } from "../../src/domain/types";

const quote = "A synthetic requirement for SDK adapter tests; it is never published as a legal rule.";
const source: SourceDocument = { doc_id: "TEST", jurisdictions: "NJ", url: "https://example.invalid/source", source_type: "test", capture: "yes", retrieved_at: "2026-10-01T00:00Z", sha256: "declared-hash", text_file: "test", status: "ok", captured: true, text: `Original source\n${quote}\n` };
const draft = (overrides: Record<string, unknown> = {}) => ({ rule_key: "test-obligation", jurisdiction: "NJ", level: "state", category: "algorithmic_rent_setting", status: "in_force", title: "Synthetic requirement", requirement: "Synthetic adapter test.", citation: "Test clause", quoted_span: quote, key_value: null, coverage_json: '{"all":[]}', exemptions: null, effective_date: null, interaction: null, supersedes: [], conflicts_with: [], fixture_rule_ids: [], conflict_flag: false, conflict_note: null, lifecycle: { enacted_on: null, effective_on: null, failed_on: null, repealed_on: null }, ...overrides });
const response = (drafts = [draft()], overrides: Record<string, unknown> = {}) => ({ content: [{ type: "text", text: JSON.stringify({ draft_rules: drafts, warnings: [] }) }], stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 50 }, ...overrides });

beforeEach(() => { clearExtractionCache(); createMessage.mockReset(); vi.stubEnv("ANTHROPIC_API_KEY", "mock-key"); vi.stubEnv("CLAUDE_MODEL", ""); });
afterEach(() => { vi.unstubAllEnvs(); });

describe("Claude extraction adapter", () => {
  it("reports an exhausted provider account without exposing its diagnostics or credentials", async () => {
    createMessage.mockRejectedValue({ status: 400, error: { error: { message: "Your credit balance is too low to access the Anthropic API. private-diagnostic-mock-key" } } });
    const error = await extractSourceChunk(source).catch(error => error);
    expect(error).toMatchObject({ code: "AI_CREDITS_UNAVAILABLE", status: 503 });
    expect(error.message).toContain("Address results and source evidence remain available");
    expect(error.message).not.toContain("mock-key");
  });
  it("recovers source whitespace without changing words, punctuation or omissions", () => {
    const original = "A landlord may require\n  no more than one month's rent.\tNotice follows.";
    expect(recoverCapturedQuote("A landlord may require no more than one month's rent.", original)).toBe("A landlord may require\n  no more than one month's rent.");
    expect(recoverCapturedQuote("A landlord may require no more than two month's rent.", original)).toBeNull();
    expect(recoverCapturedQuote("A landlord may require ... one month's rent.", original)).toBeNull();
    expect(recoverCapturedQuote("A landlord may require no more than one month's rent!", original)).toBeNull();
    expect(recoverCapturedQuote("   ", original)).toBeNull();
  });
  it("fails explicitly without server API configuration or captured text", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(isAiConfigured()).toBe(false);
    await expect(extractSourceChunk(source)).rejects.toMatchObject({ code: "AI_NOT_CONFIGURED", status: 503 });
    vi.stubEnv("ANTHROPIC_API_KEY", "mock-key");
    await expect(extractSourceChunk({ ...source, captured: false, text: undefined })).rejects.toMatchObject({ code: "SOURCE_NOT_CAPTURED", status: 422 });
    expect(createMessage).not.toHaveBeenCalled();
  });
  it("requests structured output and returns validated, review-required drafts", async () => {
    createMessage.mockResolvedValue(response());
    const result = await extractSourceChunk(source);
    expect(result).toMatchObject({ doc_id: "TEST", total_chunks: 1, next_chunk: null, requires_review: true, cache_hit: false, model: "claude-sonnet-5-5" });
    expect(result.bundle.rules[0]).toMatchObject({ source_doc_id: source.doc_id, source_url: source.url, quoted_span: quote });
    expect(result.bundle.rules[0].team_rule_id).toMatch(/^r-[a-f0-9]{16}$/);
    const params = createMessage.mock.calls[0][0];
    expect(params).not.toHaveProperty("temperature");
    expect(params.output_config.format).toMatchObject({ type: "json_schema", schema: { additionalProperties: false } });
    expect(params.system).toContain("untrusted data");
    expect(params.system).toContain("retrieval date is NEVER");
    expect(params.system).toContain("certificate_age_years is a server-derived numeric");
    expect(params.messages[0].content).toContain(quote);
    expect(result.warnings.join(" ")).toContain("administrator must review");
  });
  it("does not silently truncate long sources and exposes the next chunk", async () => {
    const text = "abcdefghij".repeat(16_156);
    const chunks = chunkSourceText(text);
    expect(chunks[0]).toMatchObject({ start: 0, end: 20_000 });
    expect(chunks[1].start).toBe(18_000);
    expect(chunks.at(-1)!.end).toBe(text.length);
    let reconstructed = chunks[0].text;
    for (let index = 1; index < chunks.length; index++) reconstructed += chunks[index].text.slice(chunks[index - 1].end - chunks[index].start);
    expect(reconstructed).toBe(text);
    createMessage.mockResolvedValue(response([]));
    const result = await extractSourceChunk({ ...source, text }, 0);
    expect(result.total_chunks).toBe(chunks.length);
    expect(result.next_chunk).toBe(1);
    expect(createMessage.mock.calls[0][0].messages[0].content).toContain(chunks[0].text);
    await expect(extractSourceChunk({ ...source, text }, chunks.length)).rejects.toMatchObject({ code: "INVALID_CHUNK", status: 400 });
  });
  it("rejects invented quotations, code predicates and invalid JSON", async () => {
    createMessage.mockResolvedValue(response([draft({ quoted_span: "An invented paragraph that is absent from the source." })]));
    await expect(extractSourceChunk(source)).rejects.toMatchObject({ code: "AI_EVIDENCE_REJECTED", status: 422 });
    createMessage.mockResolvedValue(response([draft({ coverage_json: '{"expression":"process.exit()"}' })]));
    await expect(extractSourceChunk(source)).rejects.toMatchObject({ code: "AI_INVALID_COVERAGE" });
    createMessage.mockResolvedValue(response([], { content: [{ type: "text", text: "not JSON" }] }));
    await expect(extractSourceChunk(source)).rejects.toMatchObject({ code: "AI_INVALID_JSON" });
  });
  it("rejects unknown draft fields and incomplete output rather than publishing partial rules", async () => {
    createMessage.mockResolvedValue(response([draft({ source_url: "https://attacker.invalid" })]));
    await expect(extractSourceChunk(source)).rejects.toMatchObject({ code: "AI_INVALID_DRAFT" });
    createMessage.mockResolvedValue(response([], { stop_reason: "max_tokens" }));
    await expect(extractSourceChunk(source)).rejects.toMatchObject({ code: "AI_OUTPUT_INCOMPLETE" });
    createMessage.mockResolvedValue(response([], { stop_reason: "refusal" }));
    await expect(extractSourceChunk(source)).rejects.toMatchObject({ code: "AI_REFUSED" });
  });
  it("caches validated drafts using full source content and returns independent objects", async () => {
    createMessage.mockResolvedValue(response());
    const first = await extractSourceChunk(source);
    first.bundle.rules[0].requirement = "Changed by caller";
    const cached = await extractSourceChunk(source);
    expect(cached.cache_hit).toBe(true);
    expect(cached.bundle.rules[0].requirement).toBe("Synthetic adapter test.");
    expect(createMessage).toHaveBeenCalledTimes(1);
    await extractSourceChunk({ ...source, text: `${source.text}New source content` });
    expect(createMessage).toHaveBeenCalledTimes(2);
  });
  it("sanitizes provider errors without exposing API keys or upstream payloads", async () => {
    createMessage.mockRejectedValue(new Error("Provider echoed mock-key and secret details"));
    const error = await extractSourceChunk(source).catch(error => error);
    expect(error).toBeInstanceOf(AiError);
    expect(error.code).toBe("AI_UPSTREAM_ERROR");
    expect(error.message).not.toContain("mock-key");
    expect(error.message).not.toContain("secret details");
  });
});
