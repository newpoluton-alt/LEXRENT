import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import golden from "./fixtures/vector-embedding-golden.json";
import { embedVectorText, vectorTokens, vectorDocumentText, vectorModelInfo, VECTOR_DIMENSIONS } from "../../src/domain/vector-embedding";
import { challengeData } from "../../src/domain";

describe("supplied fitted LSA embedding", () => {
  it("retains the supplied NPZ identity, dimensions and fit inventory", () => {
    const hash = createHash("sha256").update(readFileSync("AI RAG/kb_index.npz")).digest("hex");
    expect(hash).toBe(golden.source_sha256);
    expect(vectorModelInfo).toEqual({ model_id: "tfidf-lsa-v1:" + hash, dimensions: 128, vocabulary_size: 19088, document_count: 601 });
    expect(Object.isFrozen(vectorModelInfo)).toBe(true);
  });
  it("matches independent NumPy query and document projections within float32 rounding", () => {
    for (const fixture of golden.fixtures) {
      const result = embedVectorText(fixture.text);
      expect(result?.known_terms).toBe(fixture.known_terms);
      expect(result?.embedding).toHaveLength(VECTOR_DIMENSIONS);
      expect(result?.model_id).toBe(vectorModelInfo.model_id);
      result!.embedding.forEach((value, index) => {
        expect(Number.isFinite(value)).toBe(true);
        expect(Math.abs(value - fixture.embedding[index])).toBeLessThan(1e-6);
      });
      expect(Math.abs(Math.hypot(...result!.embedding) - 1)).toBeLessThan(1e-12);
    }
  });
  it("keeps the provided ASCII stopword and post-filter bigram tokenizer", () => {
    expect(vectorTokens("THE Security, and DEPOSIT! 1950.5")).toEqual(["security", "deposit", "1950", "5", "security deposit", "deposit 1950", "1950 5"]);
    expect(vectorTokens("security security")).toEqual(["security", "security", "security security"]);
  });
  it("returns no vector for empty or entirely out-of-vocabulary queries", () => {
    expect(embedVectorText("")).toBeNull();
    expect(embedVectorText("the and not no")).toBeNull();
    expect(embedVectorText("жильё выселение")).toBeNull();
    expect(embedVectorText("qzxwvvnnbbzz")).toBeNull();
  });
  it("uses the same state-name context expansion for validated document chunks", () => {
    const chunk = challengeData.knowledgeBaseChunks![0];
    // Stored evidence restores original whitespace; fitted ASCII terms are unchanged.
    const documentText = vectorDocumentText(chunk), reference = golden.fixtures.at(-1)!;
    expect(vectorTokens(documentText)).toEqual(vectorTokens(reference.text));
    const projected = embedVectorText(documentText)!;
    expect(projected.embedding).toHaveLength(128);
    projected.embedding.forEach((value, index) => expect(Math.abs(value - reference.embedding[index])).toBeLessThan(1e-6));
    expect(vectorDocumentText({ context: "Newark, NJ | official", text: "A captured passage." })).toBe("Newark, NJ | official | New Jersey\nA captured passage.");
    expect(vectorDocumentText({ context: "MA | official", text: "A captured passage." })).toBe("MA | official | Massachusetts\nA captured passage.");
  });
});
