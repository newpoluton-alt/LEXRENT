import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const { createMessage, searchVectors } = vi.hoisted(() => ({ createMessage: vi.fn(), searchVectors: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { create: createMessage }; } }));
vi.mock("../../src/server/vector-store", () => ({ searchVectorChunks: searchVectors }));
import { answerQuestion, getCurrentKnowledgeChunks, retrieveKnowledge } from "../../src/server/chat";
import { challengeData, sources } from "../../src/domain";
import type { SourceDocument } from "../../src/domain/types";
import { restoreOriginalQuote } from "../../src/domain/quotes";

const question = "Explain the NJ FAIR Act algorithmic rent setting source D069";
function responseForQuestion(input = question, addressId?: string) {
  const retrieval = retrieveKnowledge(input, {}, addressId);
  const chunk = retrieval.chunks.find(chunk => chunk.doc_id === "D069") ?? retrieval.chunks[0];
  return { content: [{ type: "text", text: JSON.stringify({ answer: "The retrieved source discusses algorithmic rental pricing. Property applicability requires the evaluator.", citations: [{ doc_id: chunk.doc_id, quoted_span: chunk.text.slice(0, 100) }] }) }], stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 50 } };
}

function capturedSource(docId: string, text: string, jurisdictions = "CA"): SourceDocument {
  return { doc_id: docId, jurisdictions, url: `https://example.invalid/captured/${docId}`, source_type: "official", capture: "yes", retrieved_at: "2026-10-01", sha256: `current-${docId}`, text_file: "test", status: "ok", captured: true, text };
}

beforeEach(() => { createMessage.mockReset(); searchVectors.mockReset(); searchVectors.mockResolvedValue({ hits: [], status: "unavailable", model: "provided-lsa-128", indexed_chunk_count: 0 }); vi.stubEnv("ANTHROPIC_API_KEY", "mock-only"); vi.stubEnv("CLAUDE_MODEL", ""); });
afterEach(() => vi.unstubAllEnvs());
describe("provided RAG index and citation grounding", () => {
  it("incorporates all provided law chunks and restores their exact source whitespace", () => {
    expect(challengeData.knowledgeBaseAudit).toEqual({ provided_records: 1101, law_chunks: 568, validated_chunks: 568, rejected_chunks: 0 });
    expect(challengeData.knowledgeBaseChunks).toHaveLength(568);
    for (const chunk of challengeData.knowledgeBaseChunks!) expect(sources.find(source => source.doc_id === chunk.doc_id)?.text?.includes(chunk.text)).toBe(true);
  });
  it("retrieves official evidence for a named source and multilingual topics", () => {
    expect(retrieveKnowledge(question).chunks.some(chunk => chunk.doc_id === "D069")).toBe(true);
    expect(retrieveKnowledge("депозит залог California").chunks.length).toBeGreaterThan(0);
    expect(retrieveKnowledge("depósito Berkeley").chunks.length).toBeGreaterThan(0);
    const source: SourceDocument = { doc_id: "CUSTOM", jurisdictions: "CA", url: "https://example.invalid/captured", source_type: "test", capture: "yes", retrieved_at: "2026-10-01", sha256: "new", text_file: "test", status: "ok", captured: true, text: "A synthetic security deposit passage for updated-capture retrieval tests." };
    expect(retrieveKnowledge("security deposit", { sources: [source] }).chunks[0].text).toBe(source.text);
  });
  it("retrieves the statutory deposit cap and small-landlord exception for a California limits question", () => {
    const retrieved = retrieveKnowledge("What are California security deposit limits?");
    const statutorySource = sources.find(source => source.doc_id === "D025")!;
    const intervals = retrieved.chunks.filter(chunk => chunk.doc_id === "D025").map(chunk => ({ start: chunk.start_offset, end: chunk.end_offset }));
    expect(restoreOriginalQuote(statutorySource.text!, "an amount equal to one month’s rent", intervals)).not.toBeNull();
    expect(restoreOriginalQuote(statutorySource.text!, "an amount equal to two months’ rent", intervals)).not.toBeNull();
    expect(retrieved.chunks.reduce((sum, chunk) => sum + chunk.text.length, 0)).toBeLessThanOrEqual(32_000);
    expect(new Set(retrieved.chunks.map(chunk => chunk.doc_id)).size).toBeGreaterThan(1);
  });
  it("provides verified quotations and explicitly preserves the no-published-rules limitation", async () => {
    createMessage.mockResolvedValue(responseForQuestion());
    const result = await answerQuestion({ question });
    expect(result.answer).toContain("Property-specific applicability has not been evaluated");
    expect(result.citations[0]).toMatchObject({ doc_id: "D069", url: sources.find(source => source.doc_id === "D069")!.url });
    expect(result.scope).toBe("research_assistance");
    expect(result.model).toBe("claude-sonnet-5-5");
    expect(createMessage.mock.calls[0][0].output_config.format.type).toBe("json_schema");
    expect(createMessage.mock.calls[0][0]).not.toHaveProperty("temperature");
    expect(createMessage.mock.calls[0][0].system).toContain("Address applicability is decided ONLY");
    expect(createMessage.mock.calls[0][0].system).toContain("Absence from the retrieved passages NEVER proves");
  });
  it("supplies deterministic property uncertainty and does not promote a postal city to verified", async () => {
    createMessage.mockResolvedValue(responseForQuestion(question, "A0003"));
    const result = await answerQuestion({ question, address_id: "A0003" });
    const supplied = JSON.parse(createMessage.mock.calls[0][0].messages[0].content);
    expect(supplied.deterministic_property_context.jurisdiction.verified).toBe(false);
    expect(supplied.deterministic_property_context.legal_results).toEqual([]);
    expect(result.missing_facts).toContain("legal_municipality");
  });
  it("keeps cross-state source citations separate from the selected property's coverage", async () => {
    createMessage.mockResolvedValue(responseForQuestion(question, "A0001"));
    const result = await answerQuestion({ question, address_id: "A0001" });
    expect(result.citations[0].doc_id).toBe("D069");
    expect(result.notices.some(notice => notice.includes("Source evidence includes NJ") && notice.includes("selected property is in CA"))).toBe(true);
  });
  it("rejects invented, unretrieved or absent evidence", async () => {
    createMessage.mockResolvedValue({ ...responseForQuestion(), content: [{ type: "text", text: JSON.stringify({ answer: "Invented answer", citations: [{ doc_id: "D069", quoted_span: "A fabricated legal quotation that does not appear in the source." }] }) }] });
    await expect(answerQuestion({ question })).rejects.toMatchObject({ code: "AI_CITATION_REJECTED", status: 422 });
    createMessage.mockResolvedValue({ ...responseForQuestion(), content: [{ type: "text", text: JSON.stringify({ answer: "Unsupported answer", citations: [] }) }] });
    await expect(answerQuestion({ question })).rejects.toMatchObject({ code: "AI_CITATION_REQUIRED" });
  });
  it("returns exact original evidence when Claude normalizes whitespace", async () => {
    const retrieval = retrieveKnowledge(question);
    const chunk = retrieval.chunks.find(chunk => chunk.doc_id === "D069")!;
    const original = chunk.text.slice(0, 160).trim();
    createMessage.mockResolvedValue({ ...responseForQuestion(), content: [{ type: "text", text: JSON.stringify({ answer: "Research grounded in the supplied passage.", citations: [{ doc_id: "D069", quoted_span: original.replace(/\s+/g, " ") }] }) }] });
    const result = await answerQuestion({ question });
    expect(result.citations[0].quoted_span).toBe(original);
    expect(sources.find(source => source.doc_id === "D069")!.text).toContain(result.citations[0].quoted_span);
  });
  it("requires configured Claude, valid dates and bounded question/history input", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    await expect(answerQuestion({ question })).rejects.toMatchObject({ code: "AI_NOT_CONFIGURED", status: 503 });
    vi.stubEnv("ANTHROPIC_API_KEY", "mock-only");
    await expect(answerQuestion({ question, as_of: "2026-02-30" })).rejects.toMatchObject({ code: "INVALID_QUESTION", status: 400 });
    await expect(answerQuestion({ question: "q".repeat(2501) })).rejects.toMatchObject({ code: "INVALID_QUESTION" });
    await expect(answerQuestion({ question, address_id: "A9999" })).rejects.toMatchObject({ code: "PROPERTY_NOT_FOUND", status: 404 });
    expect(createMessage).not.toHaveBeenCalled();
  });
  it("returns safe provider failures and never publishes a rule bundle", async () => {
    createMessage.mockRejectedValue(new Error("Provider error with mock-only secret"));
    const error = await answerQuestion({ question }).catch(error => error);
    expect(error.code).toBe("AI_UPSTREAM_ERROR");
    expect(error.message).not.toContain("mock-only");
    expect(challengeData.verifiedRules).toEqual([]);
  });
  it("promotes a relevant semantic hit beyond the lexical shortlist with weighted rank fusion", () => {
    const documents = Array.from({ length: 9 }, (_, index) => capturedSource(`TEST${index + 1}`, "A security deposit provision in this captured document."));
    const lexical = retrieveKnowledge("security deposit", { sources: documents });
    expect(lexical.chunks).toHaveLength(8);
    expect(lexical.chunks.some(chunk => chunk.doc_id === "TEST9")).toBe(false);
    const hybrid = retrieveKnowledge("security deposit", { sources: documents }, undefined, [], [{ id: "TEST9#live-0", similarity: .9 }]);
    expect(hybrid.chunks[0].doc_id).toBe("TEST9");
    expect(hybrid.chunks).toHaveLength(8);
    expect(hybrid.vector_hit_count).toBe(1);
  });
  it("filters vector hits by current captured source IDs, state scope, and positive finite similarity", () => {
    const current = capturedSource("CURRENT", "A captured municipal housing research passage.");
    const otherState = capturedSource("OTHER", "A different captured municipal research passage.", "NJ");
    const linkOnly = { ...capturedSource("LINK", "Uncaptured link text must never become evidence."), captured: false };
    const context = { sources: [current, otherState, linkOnly] };
    const hits = [{ id: "CURRENT#live-0", similarity: .5 }, { id: "OTHER#live-0", similarity: .99 }, { id: "LINK#live-0", similarity: 1 }, { id: "STALE", similarity: 1 }, { id: "CURRENT#live-0", similarity: Number.NaN }, { id: "CURRENT#live-0", similarity: -1 }];
    const retrieved = retrieveKnowledge("California xyzunmatched", context, undefined, [], hits);
    expect(retrieved.vector_hit_count).toBe(1);
    expect(retrieved.chunks.map(chunk => chunk.doc_id)).toEqual(["CURRENT"]);
    expect(getCurrentKnowledgeChunks(context).some(chunk => chunk.doc_id === "LINK")).toBe(false);
  });
  it("ignores old compiled vector IDs after a source capture changes", () => {
    const original = sources.find(source => source.doc_id === "D025")!;
    const oldChunk = challengeData.knowledgeBaseChunks!.find(chunk => chunk.doc_id === original.doc_id)!;
    const updated = { ...original, sha256: "new-capture", text: "A revised captured source contains a revised deposit obligation." };
    const current = getCurrentKnowledgeChunks({ sources: [updated] });
    expect(current[0]).toMatchObject({ id: "D025#live-0", source_sha256: "new-capture", text: updated.text });
    const retrieval = retrieveKnowledge("revised deposit", { sources: [updated] }, undefined, [], [{ id: oldChunk.id, similarity: 1 }]);
    expect(retrieval.vector_hit_count).toBe(0);
    expect(retrieval.chunks.every(chunk => chunk.source_sha256 === "new-capture")).toBe(true);
  });
  it("passes only exact current chunks to vector search and exposes hybrid retrieval without changing citation validation", async () => {
    const chunk = retrieveKnowledge(question).chunks.find(chunk => chunk.doc_id === "D069")!;
    searchVectors.mockResolvedValue({ hits: [{ id: chunk.id, similarity: .8 }], status: "ready", model: "provided-lsa-128", indexed_chunk_count: 568 });
    createMessage.mockResolvedValue(responseForQuestion());
    const result = await answerQuestion({ question });
    expect(result.retrieval).toEqual({ mode: "hybrid_vector", vector_status: "ready", model: "provided-lsa-128", indexed_chunk_count: 568 });
    expect(searchVectors.mock.calls[0][3]).toEqual({ state: "NJ", limit: 40 });
    expect(searchVectors.mock.calls[0][1]).toEqual(getCurrentKnowledgeChunks());
    expect(result.citations[0].doc_id).toBe("D069");
    expect(sources.find(source => source.doc_id === "D069")!.text).toContain(result.citations[0].quoted_span);
    createMessage.mockResolvedValue({ ...responseForQuestion(), content: [{ type: "text", text: JSON.stringify({ answer: "Invalid semantic quote", citations: [{ doc_id: "D069", quoted_span: "Semantic similarity does not authorize a fabricated quotation." }] }) }] });
    await expect(answerQuestion({ question })).rejects.toMatchObject({ code: "AI_CITATION_REJECTED" });
  });
  it("keeps lexical evidence available when vector search fails or has no index", async () => {
    searchVectors.mockRejectedValue(new Error("private database connection detail"));
    createMessage.mockResolvedValue(responseForQuestion());
    const result = await answerQuestion({ question });
    expect(result.retrieval?.mode).toBe("lexical_fallback");
    expect(result.retrieval?.vector_status).toBe("unavailable");
    expect(result.notices.some(notice => notice.includes("lexical retrieval"))).toBe(true);
    expect(JSON.stringify(result)).not.toContain("private database");
    expect(result.citations[0].doc_id).toBe("D069");
    searchVectors.mockResolvedValue({ hits: [], status: "not_indexed", model: "provided-lsa-128", indexed_chunk_count: 0 });
    createMessage.mockResolvedValue(responseForQuestion());
    expect((await answerQuestion({ question })).retrieval).toMatchObject({ mode: "lexical_fallback", vector_status: "not_indexed" });
  });

});
