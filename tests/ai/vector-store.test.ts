import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { RetrievalChunk, SourceDocument } from "../../src/domain/types";

const mocks = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn(), embedding: vi.fn() }));
vi.mock("@neondatabase/serverless", () => ({ neon: () => ({ query: mocks.query, transaction: mocks.transaction }) }));
vi.mock("../../src/domain/vector-embedding", () => ({
  vectorModelInfo: { model_id: "test-fixed-lsa", dimensions: 128 },
  embedVectorText: mocks.embedding, vectorDocumentText: (chunk: RetrievalChunk) => chunk.context + "\n" + chunk.text,
}));
import { searchVectorChunks, syncVectorCorpus, vectorCorpusFingerprint } from "../../src/server/vector-store";

const source = { doc_id: "D025", captured: true, text: "A landlord may demand no more than one month of rent.", sha256: "source-one", url: "https://official.example/law", jurisdictions: "CA", retrieved_at: "2026-10-01T22:35Z" } as SourceDocument;
const chunk: RetrievalChunk = { id: "D025#000", doc_id: "D025", source_sha256: source.sha256, chunk_index: 0, text: source.text!, context: "CA | official", start_offset: 0, end_offset: source.text!.length };
function row(overrides: Record<string, unknown> = {}) {
  return { chunk_id: chunk.id, doc_id: chunk.doc_id, source_sha256: source.sha256, source_url: source.url, text_sha256: createHash("sha256").update(chunk.text).digest("hex"), start_offset: chunk.start_offset, end_offset: chunk.end_offset, similarity: 0.9, ...overrides };
}
beforeEach(() => {
  vi.clearAllMocks();
  // A different connection identity prevents a prior test's process cache being reused.
  process.env.DATABASE_URL = `postgresql://test.invalid/${Math.random()}`;
  mocks.query.mockResolvedValue([]); mocks.transaction.mockResolvedValue([]);
  mocks.embedding.mockReturnValue({ embedding: [1, ...new Array(127).fill(0)], known_terms: 1, model_id: "test-fixed-lsa" });
});

describe("source-versioned vector persistence", () => {
  it("atomically indexes only exact current captured spans, then reuses the complete corpus", async () => {
    const invalid = [{ ...chunk, id: "stale", source_sha256: "old-hash" }, { ...chunk, id: "forged", text: "invented rule" }, { ...chunk, id: "link", doc_id: "D002" }];
    const result = await syncVectorCorpus([chunk, ...invalid], [source, { ...source, doc_id: "D002", captured: false }]);
    expect(result).toMatchObject({ input_chunk_count: 1, indexed_chunk_count: 1, dimensions: 128 });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    const insert = mocks.query.mock.calls.find(([sql]) => String(sql).includes("jsonb_to_recordset"))!;
    const payload = JSON.parse(insert[1][1]);
    expect(payload).toHaveLength(1); expect(payload[0]).toMatchObject({ chunk_id: chunk.id, source_sha256: source.sha256, text: source.text });
    await syncVectorCorpus([chunk], [source]); expect(mocks.transaction).toHaveBeenCalledOnce();
  });
  it("changes the corpus for a source revision or retrieval metadata change, independent of chunk order", () => {
    const second = { ...chunk, id: "D025#001", chunk_index: 1 };
    expect(vectorCorpusFingerprint([chunk, second], [source])).toBe(vectorCorpusFingerprint([second, chunk], [source]));
    expect(vectorCorpusFingerprint([chunk], [source])).not.toBe(vectorCorpusFingerprint([chunk], [{ ...source, retrieved_at: "2026-10-02T00:00Z" }]));
    const revised = { ...source, text: source.text! + " New requirement.", sha256: "source-two" };
    expect(vectorCorpusFingerprint([chunk], [source])).not.toBe(vectorCorpusFingerprint([{ ...chunk, source_sha256: revised.sha256 }], [revised]));
  });
  it("rejects stale, forged, unrelated, nonfinite and nonpositive database hits", async () => {
    mocks.query.mockImplementation((sql: string) => Promise.resolve(sql.includes("AS similarity") ? [row(), row({ source_sha256: "old" }), row({ source_url: "https://attacker.example" }), row({ text_sha256: "changed" }), row({ start_offset: 1 }), row({ chunk_id: "D002#000" }), row({ similarity: Number.NaN }), row({ similarity: -0.1 })] : []));
    const result = await searchVectorChunks("deposit limit", [chunk], [source], { state: "CA", limit: 40 });
    expect(result).toMatchObject({ status: "ready", indexed_chunk_count: 1, hits: [{ id: chunk.id, similarity: 0.9 }] });
    const call = mocks.query.mock.calls.find(([sql]) => String(sql).includes("AS similarity"))!;
    expect(call[0]).toContain("embedding <=> $1::vector"); expect(call[1][2]).toBe("CA"); expect(call[1][3]).toBe(40);
  });
  it("never queries Neon for an out-of-vocabulary or invalid query vector", async () => {
    mocks.embedding.mockReturnValue(null);
    expect((await searchVectorChunks("unknown tokens", [chunk], [source])).status).toBe("empty_query");
    mocks.embedding.mockReturnValue({ embedding: [Number.NaN, ...new Array(127).fill(0)], model_id: "test-fixed-lsa" });
    expect((await searchVectorChunks("deposit", [chunk], [source])).status).toBe("empty_query");
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("returns a controlled fallback status on a database outage without leaking connection details", async () => {
    mocks.query.mockRejectedValue(new Error("private connection detail"));
    expect(await searchVectorChunks("deposit", [chunk], [source])).toEqual({ hits: [], status: "unavailable", model: "test-fixed-lsa", indexed_chunk_count: 0 });
    await expect(syncVectorCorpus([chunk], [source])).rejects.toThrow("Vector indexing is unavailable");
  });
});
